import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../examples/render-v2-weather/companion/", import.meta.url);

test("weather companion exposes typed configuration, exact preview, and explicit device Apply", async () => {
  const [html, app, css, vite] = await Promise.all(["index.html", "app.mjs", "styles.css", "vite.config.mjs"]
    .map((name) => readFile(new URL(name, root), "utf8")));
  for (const id of ["postal-code", "units", "refresh-minutes", "refresh-weather", "device-preview",
    "connect-keyboard", "apply-widget"]) assert.match(html, new RegExp(`id="${id}"`, "u"));
  assert.match(app, /fetchOpenMeteoWeather/u);
  assert.match(app, /createWeatherWidgetSource/u);
  assert.match(app, /InputLabBridgeClient/u);
  assert.match(app, /drawRenderV2Frame/u);
  assert.match(app, /BrowserFramerSceneClient/u);
  assert.match(app, /pushRenderV2Package/u);
  assert.match(app, /deviceCapability/u);
  assert.match(app, /localStorage/u);
  assert.doesNotMatch(app, /api[_-]?key|authorization/iu);
  assert.match(css, /#d97757/iu, "companion must use the existing Input Lab accent");
  assert.match(vite, /https:\/\/geocoding-api\.open-meteo\.com/u);
  assert.match(vite, /https:\/\/api\.open-meteo\.com/u);
  assert.match(vite, /hid=\(self\)/u);
});
