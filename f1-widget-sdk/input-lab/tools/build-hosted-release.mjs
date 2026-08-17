import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const sdk = path.resolve(import.meta.dirname, "../..");
const output = path.join(sdk, "input-lab/build/hosted-release");
const archive = path.join(sdk, "input-lab/build/input-lab-hosted-release.tgz");
const copy = (source, target) => cp(path.join(sdk, source), path.join(output, target), { recursive: true });
const sha256 = async (file) => createHash("sha256").update(await readFile(file)).digest("hex");
const run = promisify(execFile);

await rm(output, { recursive: true, force: true });
await Promise.all([
  mkdir(path.join(output, "input-lab/lib"), { recursive: true }),
  mkdir(path.join(output, "input-lab/assets"), { recursive: true }),
  mkdir(path.join(output, "input-lab/hosted"), { recursive: true }),
  mkdir(path.join(output, "src/render"), { recursive: true }),
  mkdir(path.join(output, "src/render-v2"), { recursive: true }),
]);
await Promise.all([
  copy("input-lab/hosted/package.json", "package.json"),
  copy("input-lab/hosted/package-lock.json", "package-lock.json"),
  copy("input-lab/server.mjs", "input-lab/server.mjs"),
  copy("input-lab/lib/compiler.mjs", "input-lab/lib/compiler.mjs"),
  copy("input-lab/lib/render-v2.mjs", "input-lab/lib/render-v2.mjs"),
  copy("input-lab/lib/render-v2-raster.mjs", "input-lab/lib/render-v2-raster.mjs"),
  copy("input-lab/lib/chromium-raster-capture.mjs", "input-lab/lib/chromium-raster-capture.mjs"),
  copy("input-lab/lib/bridge-client.mjs", "input-lab/lib/bridge-client.mjs"),
  copy("input-lab/lib/scene-transport.mjs", "input-lab/lib/scene-transport.mjs"),
  copy("input-lab/assets/hosted-glyph-cache.json", "input-lab/assets/hosted-glyph-cache.json"),
  copy("input-lab/hosted/deploy.md", "input-lab/hosted/deploy.md"),
  copy("input-lab/hosted/input-lab-api.env.example", "input-lab/hosted/input-lab-api.env.example"),
  copy("input-lab/hosted/input-lab-api.service", "input-lab/hosted/input-lab-api.service"),
  copy("input-lab/hosted/input-lab-chrome.apparmor", "input-lab/hosted/input-lab-chrome.apparmor"),
  copy("input-lab/hosted/nginx-http-rate-limits.conf", "input-lab/hosted/nginx-http-rate-limits.conf"),
  copy("input-lab/hosted/nginx-site.include.conf", "input-lab/hosted/nginx-site.include.conf"),
  copy("src/render", "src/render"),
  copy("src/render-v2", "src/render-v2"),
  copy("input-lab/build/web", "public"),
]);
const release = {
  format: "framer-input-lab-aa-panel-release-v1",
  publicOrigin: "https://htmlcss-to-framerf1-widget.g-m.dev",
  command: "node input-lab/server.mjs --hosted-origin https://htmlcss-to-framerf1-widget.g-m.dev --host 127.0.0.1 --port 9231 --max-concurrent-jobs 1",
  env: { INPUT_LAB_HOSTED_CACHE_ONLY: "1", INPUT_LAB_CHROME_PATH: "required",
    INPUT_LAB_CHROME_PRODUCT: "required" },
  publicIndexSha256: await sha256(path.join(output, "public/index.html")),
  glyphCacheSha256: await sha256(path.join(output, "input-lab/assets/hosted-glyph-cache.json")),
  apparmorProfileSha256: await sha256(path.join(output, "input-lab/hosted/input-lab-chrome.apparmor")),
};
await writeFile(path.join(output, "RELEASE.json"), `${JSON.stringify(release, null, 2)}\n`);
await rm(archive, { force: true });
await run("tar", ["-czf", archive, "-C", output, "."]);
process.stdout.write(`${output}\n${archive}\n${await sha256(archive)}\n`);
