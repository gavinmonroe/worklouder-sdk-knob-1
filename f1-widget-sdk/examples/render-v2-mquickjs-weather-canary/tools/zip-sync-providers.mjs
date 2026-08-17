import { fetchOpenMeteoWeather } from "../../../src/render-v2/weather.mjs";
import { createDeterministicWeatherProvider } from "../host-adapter.mjs";

/**
 * Weather providers for zip-sync. Every provider exposes the same
 * `lookup(config) -> normalized "framer-render-v2-weather-snapshot-v1" snapshot`
 * boundary already defined by host-adapter.mjs, so `protocol.mjs`'s
 * `encodeWeatherCanaryRevision()` works unchanged regardless of provider.
 *
 * Network I/O (fetch) happens only inside `fetchOpenMeteoWeather()`
 * (f1-widget-sdk/src/render-v2/weather.mjs, already covered by its own
 * tests); this module performs no requests itself.
 */

export const ZIP_SYNC_PROVIDERS = Object.freeze(["open-meteo", "deterministic"]);

/** Real provider: Open-Meteo geocoding + forecast, already implemented and tested in src/render-v2/weather.mjs. */
export function createOpenMeteoZipProvider({ fetchImpl = globalThis.fetch, timeoutMs = 10_000 } = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("Open-Meteo zip provider requires fetch().");
  return Object.freeze({
    async lookup(config) {
      return fetchOpenMeteoWeather(config, { fetchImpl, signal: AbortSignal.timeout(timeoutMs) });
    },
  });
}

/** Selects a provider by CLI name (`--provider open-meteo|deterministic`). */
export function createZipSyncProvider(name, options = {}) {
  if (name === "open-meteo") return createOpenMeteoZipProvider(options);
  if (name === "deterministic") return createDeterministicWeatherProvider(options);
  throw Object.assign(new Error(`Unknown zip-sync --provider "${name}"; use one of ${ZIP_SYNC_PROVIDERS.join(", ")}.`),
    { code: "ZIP_SYNC_PROVIDER_UNKNOWN" });
}
