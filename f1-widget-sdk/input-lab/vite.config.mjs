import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const inputLabRoot = fileURLToPath(new URL("./", import.meta.url));
const workspaceRoot = fileURLToPath(new URL("../../", import.meta.url));
const webHeaders = Object.freeze({
  "Content-Security-Policy": "default-src 'self'; base-uri 'none'; connect-src 'self' http://127.0.0.1:* http://localhost:*; " +
    "frame-src 'self' data: blob:; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self'; " +
    "worker-src 'none'; frame-ancestors 'none'",
  "Permissions-Policy": "hid=(self), serial=(self), usb=()",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
});

export default defineConfig({
  root: inputLabRoot,
  base: "./",
  publicDir: false,
  assetsInclude: ["**/*.bin", "**/*.ttf"],
  server: { host: "127.0.0.1", port: 5173, strictPort: true, fs: { allow: [workspaceRoot] }, headers: webHeaders },
  preview: { host: "127.0.0.1", port: 4173, strictPort: true, headers: webHeaders },
  optimizeDeps: { entries: ["index.html"] },
  build: { outDir: "build/web", emptyOutDir: true, target: "es2022", sourcemap: false },
});
