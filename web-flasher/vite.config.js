import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  plugins: [react()],
  assetsInclude: ["**/*.bin", "**/*.ttf"],
  build: {
    target: "es2022",
    sourcemap: true,
    assetsInlineLimit: 0,
  },
  server: {
    host: "127.0.0.1",
  },
  preview: {
    host: "127.0.0.1",
  },
  test: {
    include: ["test/**/*.{test,spec}.{js,jsx,ts,tsx}"],
  },
});
