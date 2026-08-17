import { createWeatherWidgetSource, fetchOpenMeteoWeather,
  normalizeWeatherWidgetConfig } from "../../../src/render-v2/weather.mjs";
import { InputLabBridgeClient } from "../../../input-lab/lib/bridge-client.mjs";
import { browserHidAvailable, BrowserFramerSceneClient } from "../../../input-lab/lib/browser-scene-hid.mjs";
import { drawRenderV2Frame } from "../../../input-lab/lib/render-v2-browser.mjs";

const STORAGE_KEY = "framer-render-v2-weather-companion-v1";
const elements = Object.freeze({ form: document.querySelector("#weather-form"),
  postalCode: document.querySelector("#postal-code"), units: document.querySelector("#units"),
  refreshMinutes: document.querySelector("#refresh-minutes"), refresh: document.querySelector("#refresh-weather"),
  weatherStatus: document.querySelector("#weather-status"), values: document.querySelector("#weather-values"),
  compilerStatus: document.querySelector("#compiler-status"), connect: document.querySelector("#connect-keyboard"),
  apply: document.querySelector("#apply-widget"), packageStatus: document.querySelector("#package-status"),
  canvas: document.querySelector("#device-preview"), browserPreview: document.querySelector("#browser-preview") });

let bridge = null;
let device = null;
let deviceCapability = null;
let compiledPackage = null;
let refreshTimer = null;
let busy = false;

function configFromForm() {
  return normalizeWeatherWidgetConfig({ postalCode: elements.postalCode.value, countryCode: "US",
    units: elements.units.value, refreshMinutes: Number(elements.refreshMinutes.value) });
}

function restoreConfig() {
  try {
    const value = normalizeWeatherWidgetConfig(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") ??
      { postalCode: "60601", units: "fahrenheit", refreshMinutes: 30 });
    elements.postalCode.value = value.postalCode;
    elements.units.value = value.units;
    elements.refreshMinutes.value = String(value.refreshMinutes);
  } catch { localStorage.removeItem(STORAGE_KEY); }
}

function updateActions() {
  elements.refresh.disabled = busy;
  elements.connect.disabled = busy || device !== null || !browserHidAvailable();
  elements.apply.disabled = busy || !compiledPackage || !deviceCapability;
  elements.apply.title = !compiledPackage ? "Refresh and compile the weather widget first"
    : !device ? "Connect the keyboard before Apply"
      : !deviceCapability ? "Connected firmware does not advertise generic Render-v2 admission"
        : "Apply the compiled weather package to ID26";
}

function showBrowserPreview(source) {
  elements.browserPreview.srcdoc = `<!doctype html><meta charset="utf-8"><style>` +
    `html,body{width:100px;height:310px;margin:0;overflow:hidden;background:#000}${source.css}</style>${source.html}`;
  elements.browserPreview.hidden = false;
  elements.canvas.hidden = true;
}

function showValues(snapshot) {
  const entries = [["Location", `${snapshot.location.name}, ${snapshot.location.region}`],
    ["Current", `${snapshot.current.temperature}° · ${snapshot.current.condition.label}`],
    ...snapshot.days.map((day) => [day.weekday, `${day.low}° → ${day.high}° · ${day.condition.label}`]),
    ["Updated", snapshot.updatedAt]];
  elements.values.replaceChildren();
  for (const [label, value] of entries) {
    const term = document.createElement("dt"); term.textContent = label;
    const definition = document.createElement("dd"); definition.textContent = value;
    elements.values.append(term, definition);
  }
}

function decodeBase64(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function scheduleRefresh(config) {
  if (refreshTimer !== null) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => refreshWeather().catch(showError), config.refreshMinutes * 60_000);
}

function showError(error) {
  elements.weatherStatus.value = error instanceof Error ? error.message : String(error);
  elements.packageStatus.value = "Last good preview retained.";
}

async function refreshWeather() {
  if (busy) return;
  busy = true; updateActions();
  const config = configFromForm();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  elements.weatherStatus.value = `Resolving ${config.postalCode}…`;
  try {
    const snapshot = await fetchOpenMeteoWeather(config, { signal: AbortSignal.timeout(10_000) });
    const source = createWeatherWidgetSource(snapshot);
    showValues(snapshot);
    showBrowserPreview(source);
    compiledPackage = null;
    if (!bridge) {
      elements.weatherStatus.value = `${snapshot.location.name} · browser preview ready`;
      elements.packageStatus.value = "Start the Input Lab bridge to compile exact RGB565 and enable Apply.";
      return;
    }
    elements.weatherStatus.value = `${snapshot.location.name} · compiling exact device frame…`;
    const response = await bridge.request("/api/render-v2/compile", source);
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error(result.message ?? result.error), { code: result.error });
    compiledPackage = decodeBase64(result.packageBase64);
    drawRenderV2Frame(elements.canvas, result.frameBase64);
    elements.canvas.hidden = false;
    elements.browserPreview.hidden = true;
    elements.weatherStatus.value = `${snapshot.location.name} · exact RGB565 preview ready`;
    elements.packageStatus.value = `${result.packageBytes} bytes · ${result.sha256.slice(0, 12)} · ` +
      `${result.push?.deviceDeployable ? "current device profile accepted" : "generic-v2 firmware required"}`;
  } finally {
    busy = false; scheduleRefresh(config); updateActions();
  }
}

async function connectBridge() {
  try {
    const client = new InputLabBridgeClient();
    await client.connect();
    bridge = client;
    elements.compilerStatus.textContent = "Compiler: ready";
  } catch (error) {
    bridge = null;
    elements.compilerStatus.textContent = "Compiler: unavailable";
    elements.compilerStatus.title = error instanceof Error ? error.message : String(error);
  }
}

async function connectKeyboard() {
  if (!browserHidAvailable()) throw new Error("WebHID requires desktop Chrome or Edge on localhost or HTTPS.");
  busy = true; updateActions(); elements.weatherStatus.value = "Waiting for the Framer chooser…";
  try {
    const client = await BrowserFramerSceneClient.connect();
    device = client;
    try { deviceCapability = await client.probeRenderV2Capabilities({ force: true }); }
    catch { deviceCapability = null; }
    elements.weatherStatus.value = deviceCapability ? "Keyboard connected · generic Render-v2 ready"
      : "Keyboard connected · this firmware is preview-only for the weather package";
  } finally { busy = false; updateActions(); }
}

async function applyWidget() {
  if (!device || !deviceCapability || !compiledPackage) throw new Error("Compile and connect a compatible keyboard first.");
  busy = true; updateActions(); elements.packageStatus.value = "Applying weather package…";
  try {
    const result = await device.pushRenderV2Package(compiledPackage);
    elements.packageStatus.value = `Applied generation ${result.generation} · ${result.sha256.slice(0, 12)}`;
  } finally { busy = false; updateActions(); }
}

elements.form.addEventListener("submit", (event) => { event.preventDefault(); refreshWeather().catch(showError); });
elements.connect.addEventListener("click", () => connectKeyboard().catch(showError));
elements.apply.addEventListener("click", () => applyWidget().catch(showError));
window.addEventListener("pagehide", () => { if (refreshTimer !== null) clearTimeout(refreshTimer); });

restoreConfig();
await connectBridge();
updateActions();
await refreshWeather().catch(showError);
