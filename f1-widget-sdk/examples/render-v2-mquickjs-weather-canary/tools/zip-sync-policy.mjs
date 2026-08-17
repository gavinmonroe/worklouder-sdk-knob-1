/**
 * Pure decision logic for one zip-sync poll cycle. No I/O: given the current
 * session/config state and a already-decoded settings word, decide what (if
 * anything) the host must do next. Keeping this side-effect-free makes the
 * ZIP-settings state machine fully unit-testable without touching a device.
 */

export const ZIP_SYNC_POLL_HZ_ACTIVE_MS = 1_000;
export const ZIP_SYNC_POLL_IDLE_MS = 5_000;
export const ZIP_SYNC_DEFAULT_REFRESH_INTERVAL_MS = 10 * 60 * 1_000;

function invariant(value, message) {
  if (!value) throw Object.assign(new Error(message), { code: "ZIP_SYNC_POLICY_INVALID" });
}

/**
 * @param {object} input
 * @param {boolean} input.started - whether the CLI has completed its one-time boot push this run.
 * @param {{settingsActive:boolean,pendingSave:boolean,saveSeq:number,postalCode:string}} input.settings - decoded slot 14.
 * @param {{postalCode:string,countryCode:string,lastSaveSeq:number}} input.config - persisted host config.
 * @param {number} input.now - current time in ms (injected for testability).
 * @param {number|null} input.lastWeatherFetchAt - ms timestamp of the last successful weather push, or null.
 * @param {number} [input.refreshIntervalMs] - periodic weather refresh interval.
 * @returns {{kind:"start"}|{kind:"settings-save"}|{kind:"weather-refresh"}|{kind:"idle"}}
 */
export function decideZipSyncAction({ started, settings, config, now, lastWeatherFetchAt,
  refreshIntervalMs = ZIP_SYNC_DEFAULT_REFRESH_INTERVAL_MS } = {}) {
  invariant(settings && typeof settings === "object", "decideZipSyncAction requires decoded settings.");
  invariant(config && typeof config === "object", "decideZipSyncAction requires the persisted config.");
  invariant(Number.isInteger(now), "decideZipSyncAction requires the current time in ms.");
  invariant(Number.isInteger(refreshIntervalMs) && refreshIntervalMs > 0,
    "decideZipSyncAction refreshIntervalMs must be a positive integer.");
  if (!started) return Object.freeze({ kind: "start" });
  if (settings.pendingSave && settings.saveSeq !== config.lastSaveSeq) {
    return Object.freeze({ kind: "settings-save" });
  }
  if (lastWeatherFetchAt == null || now - lastWeatherFetchAt >= refreshIntervalMs) {
    return Object.freeze({ kind: "weather-refresh" });
  }
  return Object.freeze({ kind: "idle" });
}

/** ~1 Hz while the device reports settingsActive, else ~5 s. */
export function nextPollIntervalMs(settings) {
  return settings?.settingsActive ? ZIP_SYNC_POLL_HZ_ACTIVE_MS : ZIP_SYNC_POLL_IDLE_MS;
}

/** Which ZIP a decision pushes: the device's freshly-saved ZIP, or the host's persisted one. */
export function targetPostalCodeFor({ decision, settings, config }) {
  const zipValue = decision.kind === "settings-save" ? settings.zip : Number(config.postalCode);
  return String(zipValue).padStart(5, "0");
}

/**
 * Builds the 0xB245 settings-ack RPC request for a decision, or null when the
 * decision (a plain periodic weather-refresh) has no settings to acknowledge.
 * `revision` must be the CURRENT (not-yet-incremented) applied weather
 * revision, per the ZIP-settings contract.
 */
export function buildSettingsAckRequest({ decision, settings, config, revision, generation }) {
  invariant(decision && typeof decision.kind === "string", "buildSettingsAckRequest requires a decision.");
  invariant(Number.isInteger(revision) && revision >= 0, "buildSettingsAckRequest revision must be a nonnegative integer.");
  invariant(Number.isInteger(generation) && generation >= 1, "buildSettingsAckRequest generation must be a positive integer.");
  if (decision.kind === "weather-refresh") return null;
  const zipValue = decision.kind === "settings-save" ? settings.zip : Number(config.postalCode);
  const auxiliary = decision.kind === "settings-save" ? settings.saveSeq : 0;
  return Object.freeze({ id: 0xb245, value: zipValue, auxiliary, generation, revision });
}
