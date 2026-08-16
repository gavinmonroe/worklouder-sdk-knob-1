import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const sdkRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const workspaceRoot = resolve(sdkRoot, "..");
const routeSource = resolve(sdkRoot, "input-lab");
const originalLoad = 'this.loadWindow(this.mainWin, "index.html"),';
const labLoad = '(process.argv.includes("--input-lab") ? this.mainWin.loadURL("http://127.0.0.1:9231") : this.loadWindow(this.mainWin, "index.html")),';

export function patchLabMainSource(source) {
  if (typeof source !== "string" || !source.includes(originalLoad) || source.includes(labLoad)) {
    throw new Error("Input Lab main-process load seam drifted; refusing to patch an unknown build.");
  }
  return source.replace(originalLoad, labLoad);
}

function parseArgs(args) {
  const options = { source: resolve(workspaceRoot, "extracted/input-app"),
    out: resolve(sdkRoot, "input-lab/build/input-lab-app-source"), force: false };
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--source") options.source = resolve(args[++index]);
    else if (args[index] === "--out") options.out = resolve(args[++index]);
    else if (args[index] === "--force") options.force = true;
    else throw new Error(`Unknown prepare-lab-app option ${args[index]}.`);
  }
  return options;
}

export async function prepareLabAppSource({ source, out, force = false }) {
  const expectedSource = resolve(workspaceRoot, "extracted/input-app");
  if (resolve(source) !== expectedSource) throw new Error("Source must be this workspace's extracted/input-app tree.");
  if (!resolve(out).startsWith(resolve(sdkRoot, "input-lab/build") + "/")) {
    throw new Error("Prepared Lab source must stay under f1-widget-sdk/input-lab/build.");
  }
  if (force) await rm(out, { recursive: true, force: true });
  await cp(source, out, { recursive: true, errorOnExist: true, force: false });
  const mainPath = join(out, "dist-electron/main/index.js");
  const main = await readFile(mainPath, "utf8");
  await writeFile(mainPath, patchLabMainSource(main));
  const destination = join(out, "dist/input-lab");
  await mkdir(join(destination, "lib"), { recursive: true });
  await Promise.all([
    cp(join(routeSource, "index.html"), join(destination, "index.html")),
    cp(join(routeSource, "styles.css"), join(destination, "styles.css")),
    cp(join(routeSource, "app.mjs"), join(destination, "app.mjs")),
    cp(join(routeSource, "lib/saved-previews.mjs"), join(destination, "lib/saved-previews.mjs")),
    cp(join(routeSource, "lib/scene-template.mjs"), join(destination, "lib/scene-template.mjs")),
    cp(join(routeSource, "lib/browser-sampler.mjs"), join(destination, "lib/browser-sampler.mjs")),
  ]);
  return Object.freeze({ status: "LAB_SOURCE_PREPARED", source, out, route: "http://127.0.0.1:9231",
    launchArgument: "--input-lab", productionAppTouched: false });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await prepareLabAppSource(parseArgs(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
