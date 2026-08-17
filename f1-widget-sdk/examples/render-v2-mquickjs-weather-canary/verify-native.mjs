#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execute = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(here, "../../..");
const canary = path.join(repository, "experiments/mquickjs-esp32s3-canary");
const vendor = path.join(canary, "vendor/mquickjs");
const cc = process.env.CC ?? "cc";
const run = (command, args, options = {}) => execute(command, args,
  { maxBuffer: 16 * 1024 * 1024, ...options });

const temporary = await mkdtemp(path.join(os.tmpdir(), "weather-mquickjs-native-"));
try {
  const generator = path.join(temporary, "framer-stdlib-gen");
  await run(cc, ["-std=c11", "-O2", `-I${vendor}`, path.join(canary, "framer_stdlib_gen.c"),
    path.join(vendor, "mquickjs_build.c"), "-o", generator]);
  await Promise.all([
    run(generator, ["-a"]).then(({ stdout }) => writeFile(path.join(temporary, "mquickjs_atom.h"), stdout)),
    run(generator, []).then(({ stdout }) => writeFile(path.join(temporary, "framer_stdlib.h"), stdout)),
  ]);
  const outputs = [];
  for (const movingGc of [false, true]) {
    const binary = path.join(temporary, movingGc ? "weather-moving-gc" : "weather");
    const flags = movingGc ? ["-O1", "-g", "-DDEBUG_GC", "-fsanitize=address",
      "-fno-omit-frame-pointer"] : ["-Os"];
    await run(cc, ["-std=c11", ...flags, "-w", `-I${temporary}`, `-I${canary}`, `-I${vendor}`,
      path.join(canary, "framer_mquickjs_canary.c"), path.join(vendor, "dtoa.c"),
      path.join(vendor, "libm.c"), path.join(vendor, "cutils.c"),
      path.join(here, "native-weather-harness.c"), "-lm", "-o", binary]);
    const { stdout } = await run(binary, [path.join(here, "weather-widget.js")], movingGc ?
      { env: { ...process.env, ASAN_OPTIONS: "halt_on_error=1" } } : {});
    outputs.push(JSON.parse(stdout));
  }
  if (outputs.some((value) => value.status !== "PASS_WEATHER_SOURCE_ON_PINNED_MQUICKJS_HOST" ||
      value.sourceBytes !== 5_667 || value.publishes !== 6 || value.appliedWeatherRevision !== 3) ||
      outputs[0].heapHighWater !== 61_496 || outputs[1].heapHighWater !== 35_168) {
    throw new Error(`Weather native proof changed: ${JSON.stringify(outputs)}`);
  }
  const source = await readFile(path.join(here, "weather-widget.js"));
  process.stdout.write(`${JSON.stringify({ ...outputs[0], movingGcAsan: "PASS",
    exactSourceBytes: source.length, hardwareRuntimeProven: false })}\n`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
