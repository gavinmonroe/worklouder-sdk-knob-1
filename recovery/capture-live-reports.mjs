#!/usr/bin/env node

import { spawn } from "node:child_process";
import { access, writeFile } from "node:fs/promises";
import path from "node:path";

function parseArgs(argv) {
  const options = { port: undefined, directory: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--port") options.port = argv[++index];
    else if (arg === "--directory") options.directory = argv[++index];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!/^\/dev\/cu\.(?:usbmodem|usbserial)/u.test(options.port ?? "")) throw new Error("An explicit USB serial --port is required.");
  if (!options.directory) throw new Error("--directory is required.");
  return options;
}

async function run(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { stdio: ["ignore", "pipe", "pipe"] });
    const output = [];
    child.stdout.on("data", (chunk) => output.push(chunk));
    child.stderr.on("data", (chunk) => output.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      const text = Buffer.concat(output).toString("utf8");
      if (code !== 0) reject(new Error(`${path.basename(executable)} exited ${code}: ${text}`));
      else resolve(text);
    });
  });
}

async function saveCommand(directory, name, executable, args) {
  const output = await run(executable, args);
  await writeFile(
    path.join(directory, `${name}.txt`),
    `$ ${[executable, ...args].join(" ")}\n${output.trim()}\n`,
    { flag: "wx" },
  );
  return output;
}

async function main() {
  const { port, directory: directoryArg } = parseArgs(process.argv.slice(2));
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const directory = path.resolve(directoryArg);
  await access(directory);
  const esptool = path.join(root, ".venv-esptool/bin/esptool");
  const espefuse = path.join(root, ".venv-esptool/bin/espefuse");
  await Promise.all([access(esptool), access(espefuse)]);
  const common = ["--chip", "esp32s3", "--port", port, "--baud", "115200", "--after", "no-reset"];

  const chip = await saveCommand(directory, "chip-id", esptool, [...common, "chip-id"]);
  if (!/ESP32-S3/iu.test(chip)) throw new Error("Connected chip is not ESP32-S3.");
  const mac = await saveCommand(directory, "read-mac", esptool, [...common, "read-mac"]);
  if (!/a4:cb:8f:af:32:10/iu.test(mac)) throw new Error("Connected MAC differs from the pre-custom F1.");
  await saveCommand(directory, "flash-id", esptool, [...common, "flash-id"]);
  const security = await saveCommand(directory, "get-security-info", esptool, [
    ...common,
    "--no-stub",
    "get-security-info",
  ]);
  if (!/Secure Boot:\s*Disabled/iu.test(security) || !/Flash Encryption:\s*Disabled/iu.test(security)) {
    throw new Error("Security state is not the expected unencrypted/unsigned configuration.");
  }

  await saveCommand(directory, "efuse-summary", espefuse, ["--chip", "esp32s3", "--port", port, "summary"]);
  const jsonPath = path.join(directory, "efuse-summary.json");
  await saveCommand(directory, "efuse-summary-json-log", espefuse, [
    "--chip",
    "esp32s3",
    "--port",
    port,
    "summary",
    "--format",
    "json",
    "--file",
    jsonPath,
  ]);
  console.log(JSON.stringify({ ok: true, port, directory, hardwareReadOnly: true }, null, 2));
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});

