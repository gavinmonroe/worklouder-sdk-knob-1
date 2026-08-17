# Render-v2 weather widget

This example turns the supplied weather reference into a `100x310` Render-v2 widget. It has two intentionally
separate delivery paths:

1. **Works with the current generic compiler:** the host resolves a postal code, embeds the current snapshot as
   literal widget content, compiles the rich layout through the proven Chromium RGB565 raster linker, and pushes a
   new F1WB+F2EP package. Fn + bottom knob cycles the highlighted forecast row on-device.
2. **Target incremental path:** the host sends one six-record revisioned snapshot (`begin`, `current`, three daily
   records, `commit`). Temperatures, WMO-derived condition IDs, and weekday IDs are packed into int32 values. This
   fits an empty eight-record queue, but F2EP v1 cannot decode or atomically commit it. It requires the edge/runtime
   capabilities listed in `WEATHER_WIDGET_EDGE_REQUIREMENTS`.

The weather request stays on the host. The keyboard does not receive network access, an API key, or a ZIP code.
The SDK provider uses Open-Meteo's postal-code geocoding and forecast endpoints and normalizes the response before
anything reaches the renderer.

## Build the offline reference

```sh
cd f1-widget-sdk
node examples/render-v2-weather/build.mjs
```

The build uses the pinned `60601` fixture, emits the compiled package plus three knob-selection PNGs under `build/`,
and performs the same fresh-render composability proof as Input Lab's Chromium Render-v2 lane. It does not access a
keyboard or the network.

For live host data:

```js
import { createWeatherWidgetSource, fetchOpenMeteoWeather } from
  "framer-f1-research-widget-sdk/renderer-v2";

const snapshot = await fetchOpenMeteoWeather({
  postalCode: "60601",
  units: "fahrenheit",
  refreshMinutes: 30,
});
const source = createWeatherWidgetSource(snapshot);
```

Pass `source` to Input Lab's Render-v2 compile route, then use its existing capability-gated package Push. Until the
incremental edge requirements land, refreshes intentionally compile/push a new snapshot package rather than claiming
that multiple live weather RPC fields are already coherent on-device.

## Run the weather companion

Start the existing Input Lab compiler bridge, then serve the focused companion on the already allowlisted localhost
origin:

```sh
cd f1-widget-sdk
npm run input-lab:bridge
npx vite --config examples/render-v2-weather/companion/vite.config.mjs
```

Open `http://127.0.0.1:5173`. The companion persists ZIP, units, and refresh interval locally; fetches weather from
the fixed Open-Meteo origins; shows an exact RGB565 preview when the bridge is available; and requires explicit WebHID
connection plus the generic Render-v2 capability before **Apply to ID26** is enabled. Scheduled refresh updates only
the preview—the device write remains an explicit user action.

See [`../../docs/weather-render-v2-audit.md`](../../docs/weather-render-v2-audit.md) for the full pipeline audit and
acceptance plan.
