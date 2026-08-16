import { execFile } from "node:child_process";
import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const sdkRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const buildRoot = resolve(sdkRoot, "input-lab/build");
const serverPath = resolve(sdkRoot, "input-lab/server.mjs");
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const execFileAsync = promisify(execFile);

function shellQuote(value) { return `'${String(value).replaceAll("'", `'\\''`)}'`; }

export function createLabEditorLauncher({ nodePath = process.execPath, sdkServerPath = serverPath,
  browserPath = chromePath } = {}) {
  return `#!/bin/zsh\nset -eu\n` +
    `LAB_URL='http://127.0.0.1:9231'\n` +
    `LAB_SERVER=${shellQuote(sdkServerPath)}\n` +
    `NODE_BIN=${shellQuote(nodePath)}\n` +
    `CHROME_BIN=${shellQuote(browserPath)}\n` +
    `PROFILE_DIR=\"$HOME/Library/Application Support/Input Lab Editor/Chrome\"\n` +
    `LOG_DIR=\"$HOME/Library/Logs\"\n` +
    `mkdir -p \"$PROFILE_DIR\" \"$LOG_DIR\"\n` +
    `if ! /usr/bin/curl -fsS --max-time 1 \"$LAB_URL/\" >/dev/null 2>&1; then\n` +
    `  /usr/bin/nohup \"$NODE_BIN\" \"$LAB_SERVER\" >\"$LOG_DIR/Input Lab Editor.log\" 2>&1 &\n` +
    `  for _attempt in {1..50}; do\n` +
    `    /usr/bin/curl -fsS --max-time 1 \"$LAB_URL/\" >/dev/null 2>&1 && break\n` +
    `    /bin/sleep 0.1\n` +
    `  done\n` +
    `fi\n` +
    `/usr/bin/curl -fsS --max-time 1 \"$LAB_URL/\" >/dev/null\n` +
    `exec \"$CHROME_BIN\" --app=\"$LAB_URL\" --user-data-dir=\"$PROFILE_DIR\" ` +
    `--no-first-run --no-default-browser-check --disable-background-networking\n`;
}

function infoPlist() {
  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n` +
    `<plist version="1.0"><dict>\n` +
    `<key>CFBundleDisplayName</key><string>Input Lab Editor</string>\n` +
    `<key>CFBundleExecutable</key><string>Input Lab Editor</string>\n` +
    `<key>CFBundleIdentifier</key><string>local.codex.input-lab-editor</string>\n` +
    `<key>CFBundleName</key><string>Input Lab Editor</string>\n` +
    `<key>CFBundlePackageType</key><string>APPL</string>\n` +
    `<key>CFBundleShortVersionString</key><string>0.3.0</string>\n` +
    `<key>CFBundleVersion</key><string>0.3.0</string>\n` +
    `<key>LSMinimumSystemVersion</key><string>12.0</string>\n` +
    `<key>NSHighResolutionCapable</key><true/>\n` +
    `</dict></plist>\n`;
}

export async function buildLabEditorApp({ out = resolve(buildRoot, "Input Lab Editor.app"), force = false } = {}) {
  const target = resolve(out);
  if (!target.startsWith(`${buildRoot}/`) || !target.endsWith(".app")) {
    throw new Error("Input Lab editor app must be an .app under f1-widget-sdk/input-lab/build.");
  }
  if (force) await rm(target, { recursive: true, force: true });
  const contents = resolve(target, "Contents");
  const executable = resolve(contents, "MacOS/Input Lab Editor");
  await mkdir(dirname(executable), { recursive: true });
  await Promise.all([
    writeFile(resolve(contents, "Info.plist"), infoPlist()),
    writeFile(executable, createLabEditorLauncher()),
  ]);
  await chmod(executable, 0o755);
  await execFileAsync("/usr/bin/codesign", ["--force", "--sign", "-", target]);
  return Object.freeze({ status: "LAB_EDITOR_APP_BUILT", out: target, route: "http://127.0.0.1:9231",
    bundleIdentifier: "local.codex.input-lab-editor", shell: "chrome-app-localhost-no-device-code",
    productionAppTouched: false });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some((value) => value !== "--force")) throw new Error(`Unknown option ${args.find((value) => value !== "--force")}.`);
  const result = await buildLabEditorApp({ force: args.includes("--force") });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
