import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

import { compileInputLabScene, compileInputLabWidgetBundle, serializeInputLabCompilation } from "./lib/compiler.mjs";
import { ChromiumRasterCaptureProvider, requireRasterCaptureProvider } from "./lib/chromium-raster-capture.mjs";
import { MockSceneTransport, requireSceneTransport } from "./lib/scene-transport.mjs";

const root = fileURLToPath(new URL("./", import.meta.url));
const SESSION_HEADER = "x-input-lab-session";
const SESSION_PLACEHOLDER = "__INPUT_LAB_SESSION_TOKEN__";
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

function loopbackOrigin(request) {
  const port = request.socket.localPort;
  const allowed = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`, `http://[::1]:${port}`]);
  const host = String(request.headers.host ?? "").toLowerCase();
  const hostAllowed = host === `127.0.0.1:${port}` || host === `localhost:${port}` || host === `[::1]:${port}`;
  const origin = request.headers.origin;
  if (!hostAllowed || (origin != null && !allowed.has(origin))) {
    throw Object.assign(new Error("Input Lab accepts only its same-origin localhost editor."),
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
  captureProvider = new ChromiumRasterCaptureProvider() } = {}) {
  requireSceneTransport(transport);
  requireRasterCaptureProvider(captureProvider);
  const sessionToken = randomBytes(32).toString("base64url");
  const server = createServer(async (request, response) => {
    try {
      const origin = loopbackOrigin(request);
      const url = new URL(request.url, "http://127.0.0.1");
      if (request.method === "OPTIONS") {
        if (origin == null) throw Object.assign(new Error("CORS preflight requires an allowed localhost origin."),
          { statusCode: 403, code: "INPUT_LAB_ORIGIN_DENIED" });
        response.writeHead(204, { "access-control-allow-origin": origin, "access-control-allow-methods": "GET,POST",
          "access-control-allow-headers": `content-type,${SESSION_HEADER}`, "access-control-max-age": "600",
          "vary": "origin" });
        response.end();
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/compile") {
        requireJson(request);
        send(response, 200, serializeInputLabCompilation(await compileInputLabScene(await readJson(request))));
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/capture") {
        requireJson(request);
        const captured = await captureProvider.capture(await readJson(request));
        send(response, 200, { mode: "raster", stats: captured.animation.stats,
          selectedFrameIndices: captured.animation.selectedFrameIndices, requestedFrameCount: captured.animation.requestedFrameCount,
          reduced: captured.animation.reduced, pngFrames: captured.pngFrames,
          sha256: captured.animation.sha256, bytes: captured.animation.binary.length,
          animationBase64: captured.animation.binary.toString("base64"), settings: captured.settings });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/apply") {
        requireJson(request);
        requireSession(request, sessionToken);
        const body = await readJson(request, 512 * 1024);
        const compiled = await compileInputLabWidgetBundle({ ...body, captureProvider });
        const result = await transport.applySceneBundle(compiled);
        send(response, 200, { ...result, compiledSlots: compiled.compiledSlots.map((slot) => slot.mode === "raster"
          ? { mode: slot.mode, stats: slot.animation.stats, selectedFrameIndices: slot.animation.selectedFrameIndices,
            sha256: slot.animation.sha256, bytes: slot.animation.binary.length, browser: slot.browser }
          : { mode: slot.mode, sha256: slot.scene.sha256, bytes: slot.binary.length }) });
        return;
      }
      if (request.method !== "GET") return send(response, 405, { error: "METHOD_NOT_ALLOWED" });
      const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
      const relative = normalize(pathname).replace(/^[/\\]+/u, "");
      if (relative.startsWith("..") || (!relative.startsWith("lib/") && !["index.html", "styles.css", "app.mjs"].includes(relative))) {
        return send(response, 404, { error: "NOT_FOUND" });
      }
      let body = await readFile(join(root, relative));
      if (relative === "index.html") {
        body = Buffer.from(body.toString("utf8").replace(SESSION_PLACEHOLDER, sessionToken));
      }
      response.writeHead(200, { "content-type": contentTypes[extname(relative)] ?? "application/octet-stream",
        "content-length": body.length, "cache-control": "no-store", "x-content-type-options": "nosniff",
        "x-frame-options": "DENY", "referrer-policy": "no-referrer",
        "content-security-policy": "default-src 'self'; base-uri 'none'; connect-src 'self'; frame-ancestors 'none'; " +
          "img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self'" });
      response.end(body);
    } catch (error) {
      send(response, error.statusCode ?? (error.code === "NO_LIVE_INPUT_LAB_SCENE_TRANSPORT" ? 503 : 422),
        { error: error.code ?? "INPUT_LAB_ERROR", message: error.message });
    }
  });
  Object.defineProperty(server, "inputLabSessionToken", { value: sessionToken, enumerable: false });
  return server;
}

export async function startInputLabServer({ port = 9231, transport } = {}) {
  const server = createInputLabServer({ ...(transport ? { transport } : {}) });
  await new Promise((resolve, reject) => server.once("error", reject).listen(port, "127.0.0.1", resolve));
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = await startInputLabServer();
  const address = server.address();
  process.stdout.write(`Input Lab: http://127.0.0.1:${address.port}\nMock scene transport active; no device I/O.\n`);
}
