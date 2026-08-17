import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";

import { decodeRasterAnimation, fitRasterAnimation, rgb565FrameToRgba8888,
  rgba8888ToRgb565Frame } from "../../src/render/index.mjs";

const PLATFORM_CHROME = process.platform === "linux" ? "/usr/bin/google-chrome-stable"
  : "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
export const INPUT_LAB_CHROME = process.env.INPUT_LAB_CHROME_PATH ?? PLATFORM_CHROME;
export const PINNED_INPUT_LAB_CHROME_PRODUCT = process.env.INPUT_LAB_CHROME_PRODUCT ?? "Chrome/151.0.7922.138";
export const DEFAULT_RASTER_SETTINGS = Object.freeze({ fps: 5, loopDurationMs: 2000, maxFrames: 10,
  maxBytes: 128 * 1024, interaction: "none" });
export const CHROMIUM_CAPTURE_LIMITS = Object.freeze({ startupTimeoutMs: 8_000, connectTimeoutMs: 5_000,
  commandTimeoutMs: 5_000, jobTimeoutMs: 60_000, shutdownGraceMs: 400 });

function invariant(value, message) { if (!value) throw new Error(message); }
function captureError(code, message, cause) {
  return Object.assign(new Error(message, cause ? { cause } : undefined), { code });
}

function timeoutError(stage, milliseconds) {
  return captureError("CHROMIUM_CAPTURE_TIMEOUT", `${stage} exceeded its ${milliseconds}ms deadline.`);
}

function abortReason(signal) {
  return signal?.reason instanceof Error ? signal.reason
    : captureError("CHROMIUM_CAPTURE_ABORTED", "Chromium raster capture was aborted.");
}

function throwIfAborted(signal) { if (signal?.aborted) throw abortReason(signal); }

function delay(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    throwIfAborted(signal);
    let settled = false;
    const finish = (action, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      action(value);
    };
    const onAbort = () => finish(reject, abortReason(signal));
    const timer = setTimeout(() => finish(resolve), milliseconds);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function normalizeCaptureLimits(value = {}) {
  const limits = { ...CHROMIUM_CAPTURE_LIMITS, ...value };
  for (const [name, maximum] of [["startupTimeoutMs", 30_000], ["connectTimeoutMs", 30_000],
    ["commandTimeoutMs", 30_000], ["jobTimeoutMs", 120_000], ["shutdownGraceMs", 5_000]]) {
    invariant(Number.isInteger(limits[name]) && limits[name] >= (name === "shutdownGraceMs" ? 0 : 1) &&
      limits[name] <= maximum, `Chromium ${name} is outside its bounded range.`);
  }
  return Object.freeze(limits);
}

export class CdpClient {
  constructor(socket, { commandTimeoutMs = CHROMIUM_CAPTURE_LIMITS.commandTimeoutMs, signal } = {}) {
    this.socket = socket;
    this.commandTimeoutMs = commandTimeoutMs;
    this.signal = signal;
    this.nextId = 1;
    this.pending = new Map();
    this.closed = false;
    this.onMessage = ({ data }) => {
      let message;
      try { message = JSON.parse(String(data)); }
      catch (error) {
        this.fail(captureError("CHROMIUM_CDP_PROTOCOL", "Chrome CDP returned malformed JSON.", error), true);
        return;
      }
      if (!message.id || !this.pending.has(message.id)) return;
      const { resolve, reject, timer } = this.pending.get(message.id);
      this.pending.delete(message.id);
      clearTimeout(timer);
      if (message.error) reject(new Error(`CDP ${message.error.code}: ${message.error.message}`));
      else resolve(message.result ?? {});
    };
    this.onError = () => this.fail(captureError("CHROMIUM_CDP_CLOSED",
      "Chrome CDP socket failed before capture completed."));
    this.onClose = () => this.fail(captureError("CHROMIUM_CDP_CLOSED",
      "Chrome CDP socket closed before capture completed."));
    this.onAbort = () => this.fail(abortReason(this.signal), true);
    socket.addEventListener("message", this.onMessage);
    socket.addEventListener("error", this.onError);
    socket.addEventListener("close", this.onClose);
    signal?.addEventListener("abort", this.onAbort, { once: true });
  }

  static async connect(url, { createWebSocket = (endpoint) => new WebSocket(endpoint),
    connectTimeoutMs = CHROMIUM_CAPTURE_LIMITS.connectTimeoutMs,
    commandTimeoutMs = CHROMIUM_CAPTURE_LIMITS.commandTimeoutMs, signal } = {}) {
    throwIfAborted(signal);
    let socket;
    try { socket = createWebSocket(url); }
    catch (error) {
      throw captureError("CHROMIUM_CDP_CONNECT", "Unable to create the bounded Chrome CDP socket.", error);
    }
    await new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        clearTimeout(timer);
        socket.removeEventListener("open", onOpen);
        socket.removeEventListener("error", onError);
        socket.removeEventListener("close", onClose);
        signal?.removeEventListener("abort", onAbort);
      };
      const finish = (action, value, close = false) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (close) try { socket.close(); } catch {}
        action(value);
      };
      const onOpen = () => finish(resolve);
      const onError = () => finish(reject, captureError("CHROMIUM_CDP_CONNECT",
        "Unable to connect to the bounded Chrome CDP session."), true);
      const onClose = () => finish(reject, captureError("CHROMIUM_CDP_CONNECT",
        "Chrome CDP socket closed during connection."), true);
      const onAbort = () => finish(reject, abortReason(signal), true);
      const timer = setTimeout(() => finish(reject,
        timeoutError("Chrome CDP connection", connectTimeoutMs), true), connectTimeoutMs);
      socket.addEventListener("open", onOpen, { once: true });
      socket.addEventListener("error", onError, { once: true });
      socket.addEventListener("close", onClose, { once: true });
      signal?.addEventListener("abort", onAbort, { once: true });
    });
    return new CdpClient(socket, { commandTimeoutMs, signal });
  }

  send(method, params = {}, sessionId) {
    throwIfAborted(this.signal);
    if (this.closed) return Promise.reject(captureError("CHROMIUM_CDP_CLOSED",
      `Chrome CDP is closed; cannot send ${method}.`));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(timeoutError(`Chrome CDP command ${method}`,
        this.commandTimeoutMs), true), this.commandTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); }
      catch (error) {
        this.fail(captureError("CHROMIUM_CDP_CLOSED", `Unable to send Chrome CDP command ${method}.`, error), true);
      }
    });
  }

  fail(error, closeSocket = false) {
    if (this.closed) return;
    this.closed = true;
    for (const { reject, timer } of this.pending.values()) { clearTimeout(timer); reject(error); }
    this.pending.clear();
    this.signal?.removeEventListener("abort", this.onAbort);
    this.socket.removeEventListener("message", this.onMessage);
    this.socket.removeEventListener("error", this.onError);
    this.socket.removeEventListener("close", this.onClose);
    if (closeSocket) try { this.socket.close(); } catch {}
  }

  close() {
    this.fail(captureError("CHROMIUM_CDP_CLOSED", "Chrome CDP client closed."));
    try { this.socket.close(); } catch {}
  }
}

async function stopChromeChild(child, state, exit, shutdownGraceMs) {
  if (!child || state.exited || state.spawnFailed) return;
  try { child.kill("SIGTERM"); } catch {}
  await Promise.race([exit, delay(shutdownGraceMs)]);
  if (!state.exited) {
    try { child.kill("SIGKILL"); } catch {}
    await Promise.race([exit, delay(shutdownGraceMs)]);
  }
}

export async function launchBoundedChrome(spawnProcess, chromePath, args,
  { startupTimeoutMs = CHROMIUM_CAPTURE_LIMITS.startupTimeoutMs,
    shutdownGraceMs = CHROMIUM_CAPTURE_LIMITS.shutdownGraceMs, signal } = {}) {
  throwIfAborted(signal);
  let child;
  try { child = spawnProcess(chromePath, args, { stdio: ["ignore", "ignore", "pipe"] }); }
  catch (error) {
    throw captureError("CHROMIUM_SPAWN_FAILED", `Unable to start Chromium at ${chromePath}.`, error);
  }
  let stderr = "";
  let endpointResolve;
  const endpoint = new Promise((resolve) => { endpointResolve = resolve; });
  child.stderr?.on("data", (chunk) => {
    stderr = `${stderr}${chunk.toString()}`.slice(-16_384);
    const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/u);
    if (match) endpointResolve(match[1]);
  });
  const state = { exited: false, spawnFailed: false, exitCode: null, spawnError: null };
  let exitResolve;
  const exit = new Promise((resolve) => { exitResolve = resolve; });
  child.once("exit", (code) => {
    state.exited = true; state.exitCode = code; exitResolve();
  });
  const spawnFailure = new Promise((_, reject) => child.once("error", (error) => {
    state.spawnFailed = true;
    state.spawnError = error;
    exitResolve();
    reject(captureError("CHROMIUM_SPAWN_FAILED", `Unable to start Chromium at ${chromePath}.`, error));
  }));
  let timeoutId;
  let abortHandler;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(timeoutError("Chromium CDP startup", startupTimeoutMs)), startupTimeoutMs);
  });
  const aborted = new Promise((_, reject) => {
    abortHandler = () => reject(abortReason(signal));
    signal?.addEventListener("abort", abortHandler, { once: true });
  });
  let webSocketUrl;
  try {
    webSocketUrl = await Promise.race([endpoint, timeout, spawnFailure, aborted, exit.then(() => {
      if (state.spawnFailed) throw captureError("CHROMIUM_SPAWN_FAILED",
        `Unable to start Chromium at ${chromePath}.`, state.spawnError);
      throw captureError("CHROMIUM_STARTUP_FAILED",
        `Chromium exited ${state.exitCode} before CDP startup. ${stderr.trim()}`);
    })]);
  } catch (error) {
    await stopChromeChild(child, state, exit, shutdownGraceMs);
    throw error;
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener("abort", abortHandler);
  }
  let closed = false;
  return { child, exit, get exited() { return state.exited; }, webSocketUrl, async close() {
    if (closed) return;
    closed = true;
    await stopChromeChild(child, state, exit, shutdownGraceMs);
  } };
}

function validateLocalUrls(source, label) {
  for (const match of source.matchAll(/url\s*\(([^)]*)\)/giu)) {
    const value = match[1].trim().replace(/^(['"])(.*)\1$/u, "$2");
    invariant(value.startsWith("data:") || /^#[A-Za-z_][\w:.-]*$/u.test(value),
      `${label} URLs must be data: resources or local SVG fragments.`);
  }
}

export function sanitizeRasterDocument({ html, css, interaction = "none" }) {
  invariant(typeof html === "string" && Buffer.byteLength(html) <= 128 * 1024, "Raster HTML exceeds 128 KiB.");
  invariant(typeof css === "string" && Buffer.byteLength(css) <= 128 * 1024, "Raster CSS exceeds 128 KiB.");
  invariant(interaction === "none" || interaction === "hover", "Raster interaction must be none or hover.");
  invariant(!/<(?:script|style|iframe|frame|frameset|object|embed|base|meta|link|form|video|audio|source|track|portal|animate|set)\b|\son[a-z]+\s*=|javascript\s*:/iu.test(html),
    "Scripts, navigation, active media, embedded documents, base URLs, and event handlers are forbidden.");
  invariant(!/\s(?:src|srcset|href|xlink:href|poster|action|formaction|ping|cite|background|manifest|http-equiv)\s*=/iu.test(html),
    "Navigable and resource-loading HTML attributes are forbidden.");
  invariant(!/@import\b|expression\s*\(|<\/style/iu.test(css), "Raster CSS may use inline/data resources only.");
  validateLocalUrls(css, "Raster CSS");
  validateLocalUrls(html, "Raster HTML");
  const safeCss = interaction === "hover"
    ? css.replace(/:hover\b/gu, ":is(.input-lab-hover, .input-lab-hover *)")
    : css;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" ` +
    `content="default-src 'none'; base-uri 'none'; connect-src 'none'; form-action 'none'; frame-src 'none'; ` +
    `object-src 'none'; media-src 'none'; worker-src 'none'; style-src 'unsafe-inline'; img-src data:; ` +
    `font-src data:; script-src 'none'">` +
    `<style>html,body{width:100px;height:310px;margin:0;overflow:hidden;background:#000}${safeCss}</style></head>` +
    `<body class="${interaction === "hover" ? "input-lab-hover" : ""}">${html}</body></html>`;
}

function normalizeSettings(value = {}) {
  const settings = { ...DEFAULT_RASTER_SETTINGS, ...value };
  invariant(Number.isFinite(settings.fps) && settings.fps >= 1 && settings.fps <= 10, "Raster fps must be 1..10.");
  invariant(Number.isInteger(settings.loopDurationMs) && settings.loopDurationMs >= 100 && settings.loopDurationMs <= 10_000,
    "Raster loop duration must be 100..10000ms.");
  invariant(Number.isInteger(settings.maxFrames) && settings.maxFrames >= 1 && settings.maxFrames <= 60,
    "Raster maxFrames must be 1..60.");
  invariant(Number.isInteger(settings.maxBytes) && settings.maxBytes >= 64 * 1024 && settings.maxBytes <= 128 * 1024,
    "Raster maxBytes must be 64KiB..128KiB.");
  invariant(settings.interaction === "none" || settings.interaction === "hover", "Unsupported interaction state.");
  return Object.freeze(settings);
}

export class ChromiumRasterCaptureProvider {
  constructor({ chromePath = INPUT_LAB_CHROME, expectedProduct = PINNED_INPUT_LAB_CHROME_PRODUCT,
    spawnProcess = spawn, createWebSocket = (endpoint) => new WebSocket(endpoint), limits } = {}) {
    this.chromePath = chromePath;
    this.expectedProduct = expectedProduct;
    this.spawnProcess = spawnProcess;
    this.createWebSocket = createWebSocket;
    this.limits = normalizeCaptureLimits(limits);
  }

  async capture({ html, css, settings: rawSettings, signal: callerSignal }) {
    const settings = normalizeSettings(rawSettings);
    const cadenceMs = Math.max(100, Math.round(1000 / settings.fps / 100) * 100);
    const frameCount = Math.min(settings.maxFrames, Math.max(1, Math.floor(settings.loopDurationMs / cadenceMs)));
    const actualLoopDurationMs = frameCount * cadenceMs;
    const actualFps = 1000 / cadenceMs;
    const controller = new AbortController();
    const onCallerAbort = () => controller.abort(abortReason(callerSignal));
    callerSignal?.addEventListener("abort", onCallerAbort, { once: true });
    if (callerSignal?.aborted) onCallerAbort();
    const jobTimer = setTimeout(() => controller.abort(timeoutError("Chromium raster capture job",
      this.limits.jobTimeoutMs)), this.limits.jobTimeoutMs);
    const { signal } = controller;
    let directory;
    let chrome;
    let cdp;
    try {
      throwIfAborted(signal);
      directory = await mkdtemp(join(tmpdir(), "f1-input-lab-raster-"));
      throwIfAborted(signal);
      const htmlPath = join(directory, "scene.html");
      const profilePath = join(directory, "chrome-profile");
      const frames = [];
      await writeFile(htmlPath, sanitizeRasterDocument({ html, css, interaction: settings.interaction }));
      throwIfAborted(signal);
      const args = ["--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-background-networking",
          "--disable-component-update", "--disable-default-apps", "--disable-extensions", "--disable-sync",
          "--disable-gpu", "--disable-dev-shm-usage", "--disable-lcd-text", "--font-render-hinting=none", "--hide-scrollbars",
          "--run-all-compositor-stages-before-draw", "--disable-threaded-animation", "--disable-threaded-scrolling",
          "--force-device-scale-factor=1", `--user-data-dir=${profilePath}`, "--window-size=100,310",
          "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0", "about:blank"];
      chrome = await launchBoundedChrome(this.spawnProcess, this.chromePath, args,
        { startupTimeoutMs: this.limits.startupTimeoutMs, shutdownGraceMs: this.limits.shutdownGraceMs, signal });
      let product;
      cdp = await CdpClient.connect(chrome.webSocketUrl, { createWebSocket: this.createWebSocket,
        connectTimeoutMs: this.limits.connectTimeoutMs, commandTimeoutMs: this.limits.commandTimeoutMs, signal });
      ({ product } = await cdp.send("Browser.getVersion"));
      invariant(product === this.expectedProduct,
        `Input Lab Chrome version mismatch: expected ${this.expectedProduct}, received ${product}.`);
      const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
      const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
      await cdp.send("Page.enable", {}, sessionId);
      await cdp.send("Emulation.setDeviceMetricsOverride",
        { width: 100, height: 310, deviceScaleFactor: 1, mobile: false }, sessionId);
      for (let index = 0; index < frameCount; index += 1) {
        const elapsedMs = index * cadenceMs;
        // A same-page compositor capture can omit unchanged static layers after an animated layer advances.
        // Reloading inside the one bounded CDP process gives every frame a full deterministic paint.
        await cdp.send("Page.navigate", { url: `${pathToFileURL(htmlPath).href}?inputLabFrame=${index}` }, sessionId);
        for (let attempt = 0; attempt < 200; attempt += 1) {
          const ready = await cdp.send("Runtime.evaluate",
            { expression: "document.readyState", returnByValue: true }, sessionId);
          if (ready.result?.value === "complete") break;
          await delay(10, signal);
          if (attempt === 199) throw new Error("Chromium document did not finish loading.");
        }
        await cdp.send("Runtime.evaluate", { awaitPromise: true, expression:
          `new Promise(resolve=>requestAnimationFrame(()=>{for(const animation of document.getAnimations({subtree:true}))` +
          `{animation.pause();animation.currentTime=${elapsedMs}}requestAnimationFrame(resolve)}))` }, sessionId);
        await cdp.send("Page.captureScreenshot",
          { format: "png", fromSurface: true, captureBeyondViewport: false }, sessionId);
        const { data } = await cdp.send("Page.captureScreenshot",
          { format: "png", fromSurface: true, captureBeyondViewport: false }, sessionId);
        const image = await sharp(Buffer.from(data, "base64")).ensureAlpha().raw()
          .toBuffer({ resolveWithObject: true });
        throwIfAborted(signal);
        invariant(image.info.width === 100 && image.info.height === 310 && image.info.channels === 4,
          "Chromium capture is not exact 100x310 RGBA.");
        frames.push(rgba8888ToRgb565Frame(image.data, { width: 100, height: 310 }));
      }
      await cdp.send("Target.closeTarget", { targetId });
      cdp.close();
      cdp = null;
      await chrome.close();
      chrome = null;
      throwIfAborted(signal);
      const animation = fitRasterAnimation({ frames, fps: actualFps, loopDurationMs: actualLoopDurationMs,
        maxBytes: settings.maxBytes, maxFrames: settings.maxFrames, minFrames: 1 });
      throwIfAborted(signal);
      const decoded = decodeRasterAnimation(animation.binary);
      const pngFrames = [];
      for (const frame of decoded.frames) {
        const rgba = Buffer.from(rgb565FrameToRgba8888(frame, { width: 100, height: 310 }));
        pngFrames.push((await sharp(rgba, { raw: { width: 100, height: 310, channels: 4 } })
          .png().toBuffer()).toString("base64"));
        throwIfAborted(signal);
      }
      return Object.freeze({ animation, pngFrames: Object.freeze(pngFrames),
        settings: Object.freeze({ ...settings, fps: actualFps, loopDurationMs: actualLoopDurationMs, cadenceMs }),
        browser: Object.freeze({ executable: this.chromePath, product }), capturedFrameCount: frameCount });
    } finally {
      clearTimeout(jobTimer);
      callerSignal?.removeEventListener("abort", onCallerAbort);
      cdp?.close();
      await chrome?.close();
      if (directory) await rm(directory, { recursive: true, force: true });
    }
  }
}

export function requireRasterCaptureProvider(provider) {
  invariant(provider && typeof provider.capture === "function", "A raster capture provider is required.");
  return provider;
}
