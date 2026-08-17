import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createRenderV2Runtime, createWeatherWidgetSource,
  weatherSnapshotFromOpenMeteo } from "../../src/render-v2/index.mjs";
import { ChromiumRasterCaptureProvider } from "../../input-lab/lib/chromium-raster-capture.mjs";
import { compileInputLabRenderV2 } from "../../input-lab/lib/render-v2.mjs";
import { framePng } from "../render-v2-events/visual.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const output = path.join(root, "build");
const fixture = JSON.parse(await readFile(path.join(root, "fixtures/open-meteo-60601.json"), "utf8"));
const config = Object.freeze({ postalCode: "60601", countryCode: "US", units: "fahrenheit",
  refreshMinutes: 30 });
const snapshot = weatherSnapshotFromOpenMeteo(fixture, config);
const source = createWeatherWidgetSource(snapshot);
const provider = new ChromiumRasterCaptureProvider();
const compiled = await compileInputLabRenderV2(source, { captureProvider: provider });
const runtime = createRenderV2Runtime(compiled.compilation.linked);
const frames = [Buffer.from(runtime.frame)];
for (const value of [1, 1]) frames.push(Buffer.from(runtime.dispatch({ kind: "input.fn-bottom-knob",
  flags: 1, id: 1, value }).frame));

const manifest = Object.freeze({ format: "framer-render-v2-weather-example-v1", config, snapshot,
  source: Object.freeze({ rootClass: source.rootClass, renderMode: source.renderMode,
    delivery: source.delivery }),
  package: Object.freeze({ bytes: compiled.compilation.package.binary.length,
    sha256: compiled.compilation.package.sha256,
    compatibility: compiled.compilation.package.compatibility }),
  budget: compiled.compilation.package.budget,
  rasterProof: compiled.compilation.rasterProof,
  interaction: Object.freeze({ event: "input.fn-bottom-knob", encoderId: 1,
    behavior: "cycles the highlighted forecast row" }),
  liveWeather: Object.freeze({ supportedToday: "host fetch + package recompile/push",
    incrementalEvents: "contracted but blocked on weather edge requirements" }) });

await mkdir(output, { recursive: true });
await Promise.all([
  writeFile(path.join(output, "widget.html"), `${source.html}\n`),
  writeFile(path.join(output, "widget.css"), `${source.css}\n`),
  writeFile(path.join(output, "widget.js"), `${source.script}\n`),
  writeFile(path.join(output, "weather-60601.package.bin"), compiled.compilation.package.binary),
  writeFile(path.join(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`),
  ...frames.map((frame, index) => writeFile(path.join(output, `forecast-${index + 1}.png`),
    framePng(new Uint16Array(frame.buffer, frame.byteOffset, frame.byteLength / 2)))),
]);

process.stdout.write(`${JSON.stringify({ status: "RENDER_V2_WEATHER_SNAPSHOT_BUILT", output,
  package: manifest.package, budget: manifest.budget, proof: manifest.rasterProof }, null, 2)}\n`);
