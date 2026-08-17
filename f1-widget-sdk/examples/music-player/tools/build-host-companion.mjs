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
const buildRoot = path.join(sdk, "build/music-host-companion");
const packageName = "Framer F1 Music Host";
const packageRoot = path.join(buildRoot, packageName);
const downloads = path.join(workspace, "web-flasher/public/downloads");
const archiveName = "framer-f1-music-host-macos.zip";
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

await Promise.all([
  copy("f1-widget-sdk/examples/music-player/companion/Start Framer Music Sync.command",
    "Start Framer Music Sync.command"),
  copy("f1-widget-sdk/examples/music-player/companion/README.txt", "README.txt"),
  copy("f1-widget-sdk/examples/music-player/companion/run-music-host.mjs",
    "runtime/f1-widget-sdk/examples/music-player/companion/run-music-host.mjs"),
  copy("f1-widget-sdk/examples/music-player/tools/run-live-media.mjs",
    "runtime/f1-widget-sdk/examples/music-player/tools/run-live-media.mjs"),
  copy("f1-widget-sdk/src/media-transport", "runtime/f1-widget-sdk/src/media-transport"),
  copy("framer-widgets/lib/input-inspector.mjs", "runtime/framer-widgets/lib/input-inspector.mjs"),
]);

await chmod(path.join(packageRoot, "Start Framer Music Sync.command"), 0o755);
await chmod(path.join(packageRoot,
  "runtime/f1-widget-sdk/examples/music-player/companion/run-music-host.mjs"), 0o755);

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
