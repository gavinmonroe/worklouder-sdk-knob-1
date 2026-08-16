import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { decodeRasterAnimation, fitRasterAnimation, rgb565FrameToRgba8888,
  rgba8888ToRgb565Frame } from "../../src/render/index.mjs";

const requireFromInput = createRequire(new URL("../../../extracted/input-app/package.json", import.meta.url));
export const INPUT_LAB_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
export const PINNED_INPUT_LAB_CHROME_PRODUCT = "Chrome/151.0.7922.138";
export const DEFAULT_RASTER_SETTINGS = Object.freeze({ fps: 5, loopDurationMs: 2000, maxFrames: 10,
  maxBytes: 128 * 1024, interaction: "none" });

function invariant(value, message) { if (!value) throw new Error(message); }
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    socket.addEventListener("message", ({ data }) => {
      const message = JSON.parse(String(data));
      if (!message.id || !this.pending.has(message.id)) return;
      const { resolve, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(`CDP ${message.error.code}: ${message.error.message}`));
      else resolve(message.result ?? {});
    });
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", () => reject(new Error("Unable to connect to the bounded Chrome CDP session.")),
        { once: true });
    });
    return new CdpClient(socket);
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  close() { this.socket.close(); }
}

async function launchBoundedChrome(spawnProcess, chromePath, args) {
  const child = spawnProcess(chromePath, args, { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  let endpointResolve;
  const endpoint = new Promise((resolve) => { endpointResolve = resolve; });
  child.stderr?.on("data", (chunk) => {
    if (stderr.length < 8192) stderr += chunk.toString();
    const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/u);
    if (match) endpointResolve(match[1]);
  });
  let exited = false;
  let exitCode = null;
  const exit = new Promise((resolve) => child.once("exit", (code) => {
    exited = true; exitCode = code; resolve();
  }));
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error("Chromium CDP did not start within 8 seconds.")), 8_000);
  });
  let webSocketUrl;
  try {
    webSocketUrl = await Promise.race([endpoint, timeout, exit.then(() => {
      throw new Error(`Chromium exited ${exitCode} before CDP startup. ${stderr.trim()}`);
    })]);
  } finally { clearTimeout(timeoutId); }
  return { child, exit, get exited() { return exited; }, webSocketUrl, async close() {
    if (!exited) child.kill("SIGTERM");
    await Promise.race([exit, delay(400)]);
    if (!exited) { child.kill("SIGKILL"); await exit; }
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
    spawnProcess = spawn } = {}) {
    this.chromePath = chromePath;
    this.expectedProduct = expectedProduct;
    this.spawnProcess = spawnProcess;
  }

  async capture({ html, css, settings: rawSettings }) {
    const settings = normalizeSettings(rawSettings);
    const cadenceMs = Math.max(100, Math.round(1000 / settings.fps / 100) * 100);
    const frameCount = Math.min(settings.maxFrames, Math.max(1, Math.floor(settings.loopDurationMs / cadenceMs)));
    const actualLoopDurationMs = frameCount * cadenceMs;
    const actualFps = 1000 / cadenceMs;
    const directory = await mkdtemp(join(tmpdir(), "f1-input-lab-raster-"));
    try {
      const htmlPath = join(directory, "scene.html");
      const profilePath = join(directory, "chrome-profile");
      const { Jimp } = requireFromInput("jimp");
      const frames = [];
      await writeFile(htmlPath, sanitizeRasterDocument({ html, css, interaction: settings.interaction }));
      const args = ["--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-background-networking",
          "--disable-component-update", "--disable-default-apps", "--disable-extensions", "--disable-sync",
          "--disable-gpu", "--disable-lcd-text", "--font-render-hinting=none", "--hide-scrollbars",
          "--run-all-compositor-stages-before-draw", "--disable-threaded-animation", "--disable-threaded-scrolling",
          "--force-device-scale-factor=1", `--user-data-dir=${profilePath}`, "--window-size=100,310",
          "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0", "about:blank"];
      const chrome = await launchBoundedChrome(this.spawnProcess, this.chromePath, args);
      let cdp;
      let product;
      try {
        cdp = await CdpClient.connect(chrome.webSocketUrl);
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
            await delay(10);
            if (attempt === 199) throw new Error("Chromium document did not finish loading.");
          }
          await cdp.send("Runtime.evaluate", { awaitPromise: true, expression:
            `new Promise(resolve=>requestAnimationFrame(()=>{for(const animation of document.getAnimations({subtree:true}))` +
            `{animation.pause();animation.currentTime=${elapsedMs}}requestAnimationFrame(resolve)}))` }, sessionId);
          await cdp.send("Page.captureScreenshot",
            { format: "png", fromSurface: true, captureBeyondViewport: false }, sessionId);
          const { data } = await cdp.send("Page.captureScreenshot",
            { format: "png", fromSurface: true, captureBeyondViewport: false }, sessionId);
          const image = await Jimp.read(Buffer.from(data, "base64"));
          invariant(image.bitmap.width === 100 && image.bitmap.height === 310, "Chromium capture is not exact 100x310.");
          frames.push(rgba8888ToRgb565Frame(Buffer.from(image.bitmap.data), { width: 100, height: 310 }));
        }
        await cdp.send("Target.closeTarget", { targetId });
      } finally {
        cdp?.close();
        await chrome.close();
      }
      const animation = fitRasterAnimation({ frames, fps: actualFps, loopDurationMs: actualLoopDurationMs,
        maxBytes: settings.maxBytes, maxFrames: settings.maxFrames, minFrames: 1 });
      const decoded = decodeRasterAnimation(animation.binary);
      const pngFrames = [];
      for (const frame of decoded.frames) {
        const rgba = Buffer.from(rgb565FrameToRgba8888(frame, { width: 100, height: 310 }));
        pngFrames.push((await Jimp.fromBitmap({ data: rgba, width: 100, height: 310 }).getBuffer("image/png")).toString("base64"));
      }
      return Object.freeze({ animation, pngFrames: Object.freeze(pngFrames),
        settings: Object.freeze({ ...settings, fps: actualFps, loopDurationMs: actualLoopDurationMs, cadenceMs }),
        browser: Object.freeze({ executable: this.chromePath, product }), capturedFrameCount: frameCount });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}

export function requireRasterCaptureProvider(provider) {
  invariant(provider && typeof provider.capture === "function", "A raster capture provider is required.");
  return provider;
}
