import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { writeFile, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const sdkRoot = path.resolve(here, "../../f1-widget-sdk");
const flasherRoot = path.resolve(here, "..");

/**
 * Dev-only sink so an automated end-to-end test can hand the package the
 * designer actually built to a Node pusher, instead of ferrying 60+ KB through
 * a browser console. Never registered in a production build (apply: "serve"),
 * writes exactly one fixed path, and accepts nothing but a POST body.
 */
function packageSink() {
  const target = path.resolve(here, "../../.designer-e2e-package.bin");
  return {
    name: "designer-e2e-package-sink",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__e2e-package", (req, res) => {
        if (req.method !== "POST") { res.statusCode = 405; res.end("POST only"); return; }
        const chunks = [];
        req.on("data", (chunk) => chunks.push(chunk));
        req.on("end", async () => {
          const body = Buffer.concat(chunks);
          await writeFile(target, body);
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ ok: true, bytes: body.length, path: target }));
        });
      });
    },
  };
}

/**
 * Dev-only host-server runner.
 *
 * A browser cannot spawn a process, so "run your server" had to mean "download
 * this and run it in a terminal". The dev server can spawn it, so the Designer
 * offers Run / Stop / Restart directly. Registered only under `apply: "serve"`,
 * so it never exists in a production build.
 *
 * One process at a time, tracked here. Output is buffered and readable so the
 * user sees why a server exited instead of a silent failure.
 */
function hostServerRunner() {
  const state = { child: null, source: "", log: [], startedAt: null, exit: null };
  const scriptPath = path.resolve(os.tmpdir(), "f1-designer-host-server.mjs");

  const note = (line) => {
    state.log.push(line);
    if (state.log.length > 400) state.log.splice(0, state.log.length - 400);
  };

  const stop = () => new Promise((resolve) => {
    const child = state.child;
    if (!child) { resolve(false); return; }
    state.child = null;
    child.once("exit", () => resolve(true));
    child.kill("SIGTERM");
    // A server ignoring SIGTERM must not wedge the Designer.
    setTimeout(() => { try { child.kill("SIGKILL"); } catch {} resolve(true); }, 1500);
  });

  const status = () => ({
    running: Boolean(state.child),
    pid: state.child?.pid ?? null,
    startedAt: state.startedAt,
    exit: state.exit,
    log: state.log.slice(-60),
  });

  const readBody = (req) => new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });

  return {
    name: "designer-host-server-runner",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__host-server", async (req, res) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        const send = (body, code = 200) => {
          res.statusCode = code;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(body));
        };
        try {
          if (url.pathname === "/status") { send(status()); return; }

          if (url.pathname === "/stop") {
            const stopped = await stop();
            note(stopped ? "stopped by request" : "stop requested with nothing running");
            send(status());
            return;
          }

          if (url.pathname === "/start") {
            if (req.method !== "POST") { send({ error: "POST only" }, 405); return; }
            const source = await readBody(req);
            if (!source.trim()) { send({ error: "No server source supplied." }, 400); return; }
            await stop();
            state.log = [];
            state.exit = null;
            state.source = source;
            await mkdir(path.dirname(scriptPath), { recursive: true });
            await writeFile(scriptPath, source, "utf8");

            const child = spawn(process.execPath, [scriptPath], { stdio: ["ignore", "pipe", "pipe"] });
            state.child = child;
            state.startedAt = new Date().toISOString();
            child.stdout.on("data", (d) => String(d).split("\n").filter(Boolean).forEach(note));
            child.stderr.on("data", (d) => String(d).split("\n").filter(Boolean).forEach((l) => note("stderr: " + l)));
            child.on("exit", (code, signal) => {
              state.exit = { code, signal };
              note(`exited code=${code} signal=${signal ?? "none"}`);
              if (state.child === child) state.child = null;
            });
            // Give it a moment so an immediate crash is visible in the reply.
            await new Promise((r) => setTimeout(r, 400));
            send(status());
            return;
          }
          send({ error: `Unknown route ${url.pathname}` }, 404);
        } catch (cause) {
          send({ error: String(cause?.message ?? cause) }, 500);
        }
      });

      // Never leave an orphan behind when the dev server restarts.
      server.httpServer?.once("close", () => { void stop(); });
    },
  };
}

export default defineConfig({
  plugins: [react(), packageSink(), hostServerRunner()],
  base: "./",
  resolve: {
    alias: {
      "@sdk": path.resolve(sdkRoot, "src"),
      "@sdk-examples": path.resolve(sdkRoot, "examples"),
      // The SDK's render-v2 compiler hashes synchronously via node:crypto.
      // Aliasing it lets the browser import those modules UNMODIFIED, so the
      // Designer and the SDK cannot drift apart. See src/compat/node-crypto.ts.
      "node:crypto": path.resolve(here, "src/compat/node-crypto.ts"),
      // glyph-atlas.mjs shells out to build an atlas at BUILD time and calls
      // promisify(execFile) at module load, so these must resolve for the
      // import to succeed. They throw if actually invoked.
      "node:child_process": path.resolve(here, "src/compat/node-stubs.ts"),
      "node:fs/promises": path.resolve(here, "src/compat/node-stubs.ts"),
      "node:os": path.resolve(here, "src/compat/node-stubs.ts"),
      "node:util": path.resolve(here, "src/compat/node-stubs.ts"),
      "node:path": path.resolve(here, "src/compat/node-stubs.ts"),
      "@flasher": flasherRoot,
    },
  },
  optimizeDeps: {
    include: [],
  },
  worker: { format: "es" },
  build: { target: "es2022", sourcemap: true },
  server: {
    port: 5174,
    // The Designer imports the SDK's real render-v2 compiler from outside this
    // package root, so it has to be readable. Without this the alias resolves
    // but the dev server refuses to serve the file.
    fs: { allow: [path.resolve(here, ".."), sdkRoot, path.resolve(here, "../..")] },
  },
});
