#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { chmod, cp, mkdir, readFile, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const workspace = fileURLToPath(new URL("../../../../", import.meta.url));
const sdk = path.join(workspace, "f1-widget-sdk");
const buildRoot = path.join(sdk, "build/weather-host-companion");
const packageName = "Framer F1 Weather Host";
const packageRoot = path.join(buildRoot, packageName);
const downloads = path.join(workspace, "web-flasher/public/downloads");
const archiveName = "framer-f1-weather-host-macos.zip";
const archive = path.join(downloads, archiveName);
const fixedDate = new Date("2026-01-01T00:00:00.000Z");

async function copy(relativeSource, relativeDestination = relativeSource) {
  const source = path.join(workspace, relativeSource);
  const destination = path.join(packageRoot, relativeDestination);
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination, { recursive: true });
}

async function filesBelow(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...await filesBelow(path.join(directory, entry.name), relative));
    else if (entry.isFile()) files.push(relative);
  }
  return files;
}

await rm(buildRoot, { recursive: true, force: true });
await mkdir(packageRoot, { recursive: true });

// Every module below is copied at its exact repo-relative path under
// runtime/ so the relative imports inside each file keep resolving without
// rewriting. This is the same closure `tools/zip-sync.mjs` and
// `examples/render-v2-focus-timer/tools/push-focus-timer-package.mjs` need,
// traced by following their static `import ... from "./relative"` chains;
// see also f1-widget-sdk/examples/music-player/tools/build-host-companion.mjs
// for the pattern this mirrors.
await Promise.all([
  copy("f1-widget-sdk/examples/render-v2-mquickjs-weather-canary/companion/Framer F1 Weather Host.command",
    "Framer F1 Weather Host.command"),
  copy("f1-widget-sdk/examples/render-v2-mquickjs-weather-canary/companion/README.md", "README.md"),
  copy("f1-widget-sdk/examples/render-v2-mquickjs-weather-canary/companion/run-weather-host.mjs",
    "runtime/f1-widget-sdk/examples/render-v2-mquickjs-weather-canary/companion/run-weather-host.mjs"),

  // ZIP-sync host tool and its pure helper modules.
  copy("f1-widget-sdk/examples/render-v2-mquickjs-weather-canary/tools/zip-sync.mjs",
    "runtime/f1-widget-sdk/examples/render-v2-mquickjs-weather-canary/tools/zip-sync.mjs"),
  copy("f1-widget-sdk/examples/render-v2-mquickjs-weather-canary/tools/zip-sync-config.mjs",
    "runtime/f1-widget-sdk/examples/render-v2-mquickjs-weather-canary/tools/zip-sync-config.mjs"),
  copy("f1-widget-sdk/examples/render-v2-mquickjs-weather-canary/tools/zip-sync-device-rpc.mjs",
    "runtime/f1-widget-sdk/examples/render-v2-mquickjs-weather-canary/tools/zip-sync-device-rpc.mjs"),
  copy("f1-widget-sdk/examples/render-v2-mquickjs-weather-canary/tools/zip-sync-policy.mjs",
    "runtime/f1-widget-sdk/examples/render-v2-mquickjs-weather-canary/tools/zip-sync-policy.mjs"),
  copy("f1-widget-sdk/examples/render-v2-mquickjs-weather-canary/tools/zip-sync-providers.mjs",
    "runtime/f1-widget-sdk/examples/render-v2-mquickjs-weather-canary/tools/zip-sync-providers.mjs"),
  copy("f1-widget-sdk/examples/render-v2-mquickjs-weather-canary/tools/zip-sync-telemetry.mjs",
    "runtime/f1-widget-sdk/examples/render-v2-mquickjs-weather-canary/tools/zip-sync-telemetry.mjs"),
  copy("f1-widget-sdk/examples/render-v2-mquickjs-weather-canary/protocol.mjs",
    "runtime/f1-widget-sdk/examples/render-v2-mquickjs-weather-canary/protocol.mjs"),
  copy("f1-widget-sdk/examples/render-v2-mquickjs-weather-canary/host-adapter.mjs",
    "runtime/f1-widget-sdk/examples/render-v2-mquickjs-weather-canary/host-adapter.mjs"),

  // Shared renderer/render-v2 modules zip-sync and host-adapter import.
  copy("f1-widget-sdk/src/render-v2/weather.mjs", "runtime/f1-widget-sdk/src/render-v2/weather.mjs"),
  copy("f1-widget-sdk/src/render-v2/mquickjs.mjs", "runtime/f1-widget-sdk/src/render-v2/mquickjs.mjs"),
  copy("f1-widget-sdk/src/render/raster-animation.mjs", "runtime/f1-widget-sdk/src/render/raster-animation.mjs"),
  copy("f1-widget-sdk/src/render/widget-bundle.mjs", "runtime/f1-widget-sdk/src/render/widget-bundle.mjs"),
  copy("f1-widget-sdk/src/render/scene-rpc.mjs", "runtime/f1-widget-sdk/src/render/scene-rpc.mjs"),
  copy("f1-widget-sdk/src/render/glyph-atlas.mjs", "runtime/f1-widget-sdk/src/render/glyph-atlas.mjs"),

  // Input debugger bridge, shared with the Music companion.
  copy("framer-widgets/lib/input-inspector.mjs", "runtime/framer-widgets/lib/input-inspector.mjs"),

  // Clock + timer generation-2 package: publisher tool, its pure package
  // builder, the scene-RPC transport it uses, and the exact frozen source
  // parts publishFocusTimerPackageSmoke reads (see
  // examples/render-v2-focus-timer/tools/push-focus-timer-package.mjs).
  copy("f1-widget-sdk/input-lab/lib/input-wlrpc-scene-transport.mjs",
    "runtime/f1-widget-sdk/input-lab/lib/input-wlrpc-scene-transport.mjs"),
  copy("f1-widget-sdk/examples/render-v2-focus-timer/tools/push-focus-timer-package.mjs",
    "runtime/f1-widget-sdk/examples/render-v2-focus-timer/tools/push-focus-timer-package.mjs"),
  copy("f1-widget-sdk/examples/render-v2-focus-timer/focus-timer-package.mjs",
    "runtime/f1-widget-sdk/examples/render-v2-focus-timer/focus-timer-package.mjs"),
  copy("f1-widget-sdk/examples/render-v2-focus-dial/build/render-v2-focus-dial.base.f1wb",
    "runtime/f1-widget-sdk/examples/render-v2-focus-dial/build/render-v2-focus-dial.base.f1wb"),
  copy("f1-widget-sdk/examples/render-v2-focus-dial/build/render-v2-focus-dial.f2ep",
    "runtime/f1-widget-sdk/examples/render-v2-focus-dial/build/render-v2-focus-dial.f2ep"),
  copy("f1-widget-sdk/examples/render-v2-focus-timer/build/render-v2-focus-timer.f2ep",
    "runtime/f1-widget-sdk/examples/render-v2-focus-timer/build/render-v2-focus-timer.f2ep"),
  copy("f1-widget-sdk/examples/render-v2-focus-timer/build/render-v2-focus-timer.base.lzss",
    "runtime/f1-widget-sdk/examples/render-v2-focus-timer/build/render-v2-focus-timer.base.lzss"),
]);

await chmod(path.join(packageRoot, "Framer F1 Weather Host.command"), 0o755);
await chmod(path.join(packageRoot,
  "runtime/f1-widget-sdk/examples/render-v2-mquickjs-weather-canary/companion/run-weather-host.mjs"), 0o755);

const packagedFiles = await filesBelow(packageRoot);
for (const relative of packagedFiles) await utimes(path.join(packageRoot, relative), fixedDate, fixedDate);
await mkdir(downloads, { recursive: true });
await rm(archive, { force: true });
await execFileAsync("/usr/bin/zip", ["-X", "-q", archive,
  ...packagedFiles.map((file) => path.join(packageName, file))], { cwd: buildRoot });

const bytes = await readFile(archive);
const sha256 = createHash("sha256").update(bytes).digest("hex");
await writeFile(path.join(downloads, `${archiveName}.sha256`), `${sha256}  ${archiveName}\n`);
const archiveStat = await stat(archive);
await rm(buildRoot, { recursive: true, force: true });
console.log(JSON.stringify({ status: "built", archive, bytes: archiveStat.size, sha256 }, null, 2));
