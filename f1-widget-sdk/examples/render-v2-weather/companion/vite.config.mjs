import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("./", import.meta.url));
const workspace = fileURLToPath(new URL("../../../../", import.meta.url));
const headers = Object.freeze({
  "Content-Security-Policy": "default-src 'self'; base-uri 'none'; connect-src 'self' http://127.0.0.1:* " +
    "http://localhost:* https://geocoding-api.open-meteo.com https://api.open-meteo.com; " +
    "frame-src 'self'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self'; " +
    "worker-src 'none'; frame-ancestors 'none'",
  "Permissions-Policy": "hid=(self), serial=(), usb=()",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
});

export default defineConfig({ root, base: "./", publicDir: false,
  server: { host: "127.0.0.1", port: 5173, strictPort: true, fs: { allow: [workspace] }, headers },
  preview: { host: "127.0.0.1", port: 4173, strictPort: true, headers },
  optimizeDeps: { entries: ["index.html"] },
  build: { outDir: "../build/companion-web", emptyOutDir: true, target: "es2022", sourcemap: false } });
