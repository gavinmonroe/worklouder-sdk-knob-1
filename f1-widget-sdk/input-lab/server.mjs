import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

import { compileInputLabScene, compileInputLabWidgetBundle, serializeInputLabCompilation } from "./lib/compiler.mjs";
import { ChromiumRasterCaptureProvider, requireRasterCaptureProvider } from "./lib/chromium-raster-capture.mjs";
import { INPUT_LAB_BRIDGE_PROTOCOL } from "./lib/bridge-client.mjs";
import { compileInputLabRenderV2, INPUT_LAB_RENDER_V2_CAPABILITIES,
  serializeInputLabRenderV2, simulateInputLabRenderV2 } from "./lib/render-v2.mjs";
import { MockSceneTransport, requireSceneTransport, StatusOnlyCanarySceneTransport } from "./lib/scene-transport.mjs";

const root = fileURLToPath(new URL("./", import.meta.url));
const SESSION_HEADER = "x-input-lab-session";
const SESSION_PLACEHOLDER = "__INPUT_LAB_SESSION_TOKEN__";
const PROGRESS_CONTENT_TYPE = "application/x-ndjson";
const PROGRESS_STAGES = new Set(["compiling-slots", "encoding-bundle", "uploading-chunks",
  "applying-on-keyboard", "applying-local", "done"]);
const DEFAULT_WEB_ORIGINS = Object.freeze(["http://127.0.0.1:5173", "http://localhost:5173",
  "http://127.0.0.1:4173", "http://localhost:4173"]);
const contentTypes = Object.freeze({ ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".js": "text/javascript; charset=utf-8" });

async function readJson(request, maximum = 96 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maximum) throw Object.assign(new Error("Request body exceeds Input Lab bounds."), { statusCode: 413 });
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function send(response, statusCode, value, headers = {}) {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8",
    "content-length": body.length, ...headers });
  response.end(body);
}

function wantsProgress(request) {
  return String(request.headers.accept ?? "").split(",").some((value) =>
    value.trim().toLowerCase().startsWith(PROGRESS_CONTENT_TYPE));
}

function startProgress(response, headers = {}) {
  response.writeHead(200, { "content-type": `${PROGRESS_CONTENT_TYPE}; charset=utf-8`,
    "cache-control": "no-store", "x-content-type-options": "nosniff", "x-accel-buffering": "no", ...headers });
  response.flushHeaders();
}

function writeProgress(response, event) {
  if (!event || !PROGRESS_STAGES.has(event.stage)) throw new Error("Input Lab emitted an invalid progress stage.");
  const value = { type: "progress", stage: event.stage };
  if (event.current !== undefined || event.total !== undefined) {
    if (!Number.isInteger(event.current) || !Number.isInteger(event.total) ||
        event.current < 0 || event.total < 1 || event.current > event.total) {
      throw new Error("Input Lab emitted invalid progress counts.");
    }
    value.current = event.current;
    value.total = event.total;
  }
  response.write(`${JSON.stringify(value)}\n`);
}

function writeProgressResult(response, value) {
  writeProgress(response, { stage: "done" });
  response.end(`${JSON.stringify({ type: "result", value })}\n`);
}

function loopbackOrigin(request, configuredOrigins) {
  const port = request.socket.localPort;
  const allowed = new Set([...configuredOrigins, `http://127.0.0.1:${port}`,
    `http://localhost:${port}`, `http://[::1]:${port}`]);
  const host = String(request.headers.host ?? "").toLowerCase();
  const hostAllowed = host === `127.0.0.1:${port}` || host === `localhost:${port}` || host === `[::1]:${port}`;
  const origin = request.headers.origin;
  if (!hostAllowed || (origin != null && !allowed.has(origin))) {
    throw Object.assign(new Error("Input Lab accepts only its same-origin localhost editor."),
      { statusCode: 403, code: "INPUT_LAB_ORIGIN_DENIED" });
  }
  return origin;
}

function normalizeHostedOrigin(value) {
  if (value == null) return null;
  const url = new URL(String(value));
  if (url.protocol !== "https:" || url.origin !== String(value) || url.username || url.password) {
    throw new Error("Input Lab hostedOrigin must be one exact HTTPS origin.");
  }
  return url.origin;
}

function hostedRequestOrigin(request, hostedOrigin) {
  const origin = request.headers.origin == null ? null : String(request.headers.origin);
  if (origin !== null && origin !== hostedOrigin) {
    throw Object.assign(new Error("Input Lab accepts only its configured hosted origin."),
      { statusCode: 403, code: "INPUT_LAB_ORIGIN_DENIED" });
  }
  const expectedHost = new URL(hostedOrigin).host.toLowerCase();
  const forwardedHost = String(request.headers["x-forwarded-host"] ?? request.headers.host ?? "")
    .split(",", 1)[0].trim().toLowerCase();
  const proxyHost = forwardedHost.replace(/:443$/u, "");
  if (proxyHost !== expectedHost) {
    throw Object.assign(new Error("Input Lab hosted API received an unexpected Host header."),
      { statusCode: 403, code: "INPUT_LAB_ORIGIN_DENIED" });
  }
  return origin;
}

function requireJson(request) {
  if (!/^application\/json(?:\s*;|$)/iu.test(String(request.headers["content-type"] ?? ""))) {
    throw Object.assign(new Error("Input Lab POST requests require application/json."),
      { statusCode: 415, code: "INPUT_LAB_JSON_REQUIRED" });
  }
}

function requireSession(request, sessionToken) {
  const received = String(request.headers[SESSION_HEADER] ?? "");
  const expectedBytes = Buffer.from(sessionToken);
  const receivedBytes = Buffer.from(received);
  if (receivedBytes.length !== expectedBytes.length || !timingSafeEqual(receivedBytes, expectedBytes)) {
    throw Object.assign(new Error("Input Lab apply requires its per-server session token."),
      { statusCode: 403, code: "INPUT_LAB_SESSION_DENIED" });
  }
}

export function createInputLabServer({ transport = new MockSceneTransport(),
  captureProvider = new ChromiumRasterCaptureProvider(), allowedOrigins = DEFAULT_WEB_ORIGINS,
  hostedOrigin: rawHostedOrigin = null, maxConcurrentJobs = 1 } = {}) {
  requireSceneTransport(transport);
  requireRasterCaptureProvider(captureProvider);
  const hostedOrigin = normalizeHostedOrigin(rawHostedOrigin);
  if (!Number.isInteger(maxConcurrentJobs) || maxConcurrentJobs < 1 || maxConcurrentJobs > 4) {
    throw new Error("Input Lab maxConcurrentJobs must be 1..4.");
  }
  if (!Array.isArray(allowedOrigins) || allowedOrigins.some((value) => {
    try { const url = new URL(value); return !["http:", "https:"].includes(url.protocol) || url.origin !== value; }
    catch { return true; }
  })) throw new Error("Input Lab bridge origins must be exact HTTP(S) origins.");
  const sessionToken = randomBytes(32).toString("base64url");
  let activeJobs = 0;
  const runJob = async (operation) => {
    if (activeJobs >= maxConcurrentJobs) {
      throw Object.assign(new Error("Input Lab compiler is busy; retry shortly."),
        { statusCode: 429, code: "INPUT_LAB_BUSY" });
    }
    activeJobs += 1;
    try { return await operation(); }
    finally { activeJobs -= 1; }
  };
  const server = createServer(async (request, response) => {
    let corsHeaders = {};
    try {
      const origin = hostedOrigin ? hostedRequestOrigin(request, hostedOrigin) : loopbackOrigin(request, allowedOrigins);
      corsHeaders = origin == null ? {} : { "access-control-allow-origin": origin, vary: "origin" };
      const url = new URL(request.url, "http://127.0.0.1");
      if (request.method === "OPTIONS") {
        if (origin == null) throw Object.assign(new Error("CORS preflight requires an allowed localhost origin."),
          { statusCode: 403, code: "INPUT_LAB_ORIGIN_DENIED" });
        const privateNetwork = String(request.headers["access-control-request-private-network"] ?? "") === "true";
        response.writeHead(204, { "access-control-allow-origin": origin, "access-control-allow-methods": "GET,POST",
          "access-control-allow-headers": `content-type,${SESSION_HEADER}`, "access-control-max-age": "600",
          ...(privateNetwork ? { "access-control-allow-private-network": "true" } : {}),
          "vary": "origin" });
        response.end();
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/bridge") {
        const devicePush = !hostedOrigin && transport instanceof StatusOnlyCanarySceneTransport;
        send(response, 200, { status: "ok", protocol: INPUT_LAB_BRIDGE_PROTOCOL, sessionToken,
          compiler: true, rasterCapture: true, devicePush, transport: devicePush ? "status-only-canary" : "mock",
          localOnly: !hostedOrigin, hosted: Boolean(hostedOrigin), deviceTransport: hostedOrigin ? "browser-webhid" : null,
          viewport: { width: 100, height: 310 }, slots: 3,
          renderV2: { ...INPUT_LAB_RENDER_V2_CAPABILITIES, genericDevicePush: false } }, corsHeaders);
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/compile") {
        requireJson(request);
        if (hostedOrigin || origin != null) requireSession(request, sessionToken);
        const body = await readJson(request);
        const compiled = await runJob(() => compileInputLabScene(body));
        send(response, 200, serializeInputLabCompilation(compiled), corsHeaders);
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/render-v2/compile") {
        requireJson(request);
        if (hostedOrigin || origin != null) requireSession(request, sessionToken);
        const body = await readJson(request);
        const compiled = await runJob(() => compileInputLabRenderV2(body, { captureProvider }));
        send(response, 200, serializeInputLabRenderV2(compiled), corsHeaders);
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/render-v2/simulate") {
        requireJson(request);
        if (hostedOrigin || origin != null) requireSession(request, sessionToken);
        const body = await readJson(request);
        const simulated = await runJob(() => simulateInputLabRenderV2(body, { captureProvider }));
        send(response, 200, serializeInputLabRenderV2(simulated), corsHeaders);
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/capture") {
        requireJson(request);
        if (hostedOrigin || origin != null) requireSession(request, sessionToken);
        const body = await readJson(request);
        const captured = await runJob(() => captureProvider.capture(body));
        send(response, 200, { mode: "raster", stats: captured.animation.stats,
          selectedFrameIndices: captured.animation.selectedFrameIndices, requestedFrameCount: captured.animation.requestedFrameCount,
          reduced: captured.animation.reduced, pngFrames: captured.pngFrames,
          sha256: captured.animation.sha256, bytes: captured.animation.binary.length,
          animationBase64: captured.animation.binary.toString("base64"), settings: captured.settings }, corsHeaders);
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/bundle") {
        requireJson(request);
        requireSession(request, sessionToken);
        const body = await readJson(request, 512 * 1024);
        const compiled = await runJob(() => compileInputLabWidgetBundle({ ...body, captureProvider }));
        send(response, 200, { status: "compiled", format: "F1WB", slots: compiled.bundle.slots.length,
          activeSlot: compiled.bundle.activeSlot, bytes: compiled.bundle.binary.length,
          sha256: compiled.bundle.sha256, bundleBase64: compiled.bundle.binary.toString("base64") }, corsHeaders);
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/apply") {
        if (hostedOrigin) {
          throw Object.assign(new Error("Hosted Input Lab sends device RPC directly from the browser."),
            { statusCode: 405, code: "INPUT_LAB_BROWSER_DEVICE_REQUIRED" });
        }
        requireJson(request);
        requireSession(request, sessionToken);
        const body = await readJson(request, 512 * 1024);
        const streaming = wantsProgress(request);
        if (streaming) startProgress(response, corsHeaders);
        const onProgress = streaming ? (event) => writeProgress(response, event) : null;
        const compiled = await compileInputLabWidgetBundle({ ...body, captureProvider, onProgress });
        const result = await transport.applySceneBundle({ ...compiled, onProgress });
        const value = { ...result, compiledSlots: compiled.compiledSlots.map((slot) => slot.mode === "raster"
          ? { mode: slot.mode, stats: slot.animation.stats, selectedFrameIndices: slot.animation.selectedFrameIndices,
            sha256: slot.animation.sha256, bytes: slot.animation.binary.length, browser: slot.browser }
          : { mode: slot.mode, sha256: slot.scene.sha256, bytes: slot.binary.length }) };
        if (streaming) writeProgressResult(response, value);
        else send(response, 200, value, corsHeaders);
        return;
      }
      if (request.method !== "GET") return send(response, 405, { error: "METHOD_NOT_ALLOWED" }, corsHeaders);
      if (hostedOrigin) return send(response, 404, { error: "NOT_FOUND" }, corsHeaders);
      const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
      const relative = normalize(pathname).replace(/^[/\\]+/u, "");
      if (relative.startsWith("..") || (!relative.startsWith("lib/") && !["index.html", "styles.css", "app.mjs"].includes(relative))) {
        return send(response, 404, { error: "NOT_FOUND" }, corsHeaders);
      }
      let body = await readFile(join(root, relative));
      if (relative === "index.html") {
        body = Buffer.from(body.toString("utf8").replace(SESSION_PLACEHOLDER, sessionToken));
      }
      response.writeHead(200, { "content-type": contentTypes[extname(relative)] ?? "application/octet-stream",
        "content-length": body.length, "cache-control": "no-store", "x-content-type-options": "nosniff",
        ...corsHeaders,
        "x-frame-options": "DENY", "referrer-policy": "no-referrer",
        "content-security-policy": "default-src 'self'; base-uri 'none'; connect-src 'self'; frame-ancestors 'none'; " +
          "img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self'" });
      response.end(body);
    } catch (error) {
      const value = { error: error.code ?? "INPUT_LAB_ERROR", message: error.message };
      if (response.headersSent) {
        if (!response.writableEnded) response.end(`${JSON.stringify({ type: "error", ...value })}\n`);
      } else {
        send(response, error.statusCode ?? (error.code === "NO_LIVE_INPUT_LAB_SCENE_TRANSPORT" ? 503 : 422), value,
          corsHeaders);
      }
    }
  });
  Object.defineProperty(server, "inputLabSessionToken", { value: sessionToken, enumerable: false });
  return server;
}

export const createInputLabBridgeServer = createInputLabServer;

export async function startInputLabServer({ port = 9231, host = "127.0.0.1", transport, allowedOrigins,
  hostedOrigin, maxConcurrentJobs } = {}) {
  const server = createInputLabServer({ ...(transport ? { transport } : {}),
    ...(allowedOrigins ? { allowedOrigins } : {}), ...(hostedOrigin ? { hostedOrigin } : {}),
    ...(maxConcurrentJobs ? { maxConcurrentJobs } : {}) });
  await new Promise((resolve, reject) => server.once("error", reject).listen(port, host, resolve));
  return server;
}

export function parseInputLabServerArgs(args = []) {
  if (!Array.isArray(args)) throw new Error("Input Lab CLI arguments must be an array.");
  const options = { confirmLiveRpc: false };
  const allowedOrigins = [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--confirm-live-rpc") options.confirmLiveRpc = true;
    else if (argument === "--port") {
      const port = Number(args[++index]);
      if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Input Lab bridge port must be 0..65535.");
      options.port = port;
    } else if (argument === "--allow-origin") {
      const origin = args[++index];
      if (!origin) throw new Error("Input Lab --allow-origin requires an exact origin.");
      allowedOrigins.push(origin);
    } else if (argument === "--hosted-origin") {
      options.hostedOrigin = normalizeHostedOrigin(args[++index]);
    } else if (argument === "--host") {
      const host = args[++index];
      if (host !== "127.0.0.1" && host !== "::1") throw new Error("Input Lab API must bind to loopback.");
      options.host = host;
    } else if (argument === "--max-concurrent-jobs") {
      const maximum = Number(args[++index]);
      if (!Number.isInteger(maximum) || maximum < 1 || maximum > 4) {
        throw new Error("Input Lab --max-concurrent-jobs must be 1..4.");
      }
      options.maxConcurrentJobs = maximum;
    } else throw new Error(`Unknown Input Lab option: ${argument}`);
  }
  if (allowedOrigins.length) options.allowedOrigins = [...DEFAULT_WEB_ORIGINS, ...allowedOrigins];
  return Object.freeze(options);
}

export function createInputLabCliTransport({ confirmLiveRpc = false } = {}, { rpcTransport } = {}) {
  if (!confirmLiveRpc) return null;
  if (!rpcTransport) throw new Error("Live localhost RPC requires an explicitly loaded Input WLRPC transport.");
  return new StatusOnlyCanarySceneTransport({ transport: rpcTransport,
    confirmLiveRpc: true, initialGeneration: 1 });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = parseInputLabServerArgs(process.argv.slice(2));
  let transport;
  if (options.confirmLiveRpc) {
    if (options.hostedOrigin) throw new Error("Hosted Input Lab cannot enable server-side device RPC.");
    const { InputWlrpcSceneTransport } = await import("./lib/input-wlrpc-scene-transport.mjs");
    transport = createInputLabCliTransport(options, { rpcTransport: new InputWlrpcSceneTransport() });
  }
  const server = await startInputLabServer({ ...(transport ? { transport } : {}),
    ...(options.port !== undefined ? { port: options.port } : {}),
    ...(options.host ? { host: options.host } : {}),
    ...(options.allowedOrigins ? { allowedOrigins: options.allowedOrigins } : {}),
    ...(options.hostedOrigin ? { hostedOrigin: options.hostedOrigin } : {}),
    ...(options.maxConcurrentJobs ? { maxConcurrentJobs: options.maxConcurrentJobs } : {}) });
  const address = server.address();
  process.stdout.write(`Input Lab bridge: http://127.0.0.1:${address.port}\n${options.confirmLiveRpc
    ? "UNPROVEN status-only hardware canary active; commit acknowledgment does not verify UI handoff."
    : options.hostedOrigin ? `Hosted compiler API for ${options.hostedOrigin}; device RPC is browser-only.`
      : "Mock scene transport active; no device I/O."}\n`);
}
