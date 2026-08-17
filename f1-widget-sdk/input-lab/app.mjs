import { SavedPreviewStore } from "./lib/saved-previews.mjs";
import { DEFAULT_INPUT_LAB_CSS, DEFAULT_INPUT_LAB_HTML, DEFAULT_RASTER_SETTINGS,
  DEFAULT_RENDER_V2_CSS, DEFAULT_RENDER_V2_HTML, DEFAULT_RENDER_V2_SCRIPT } from "./lib/scene-template.mjs";
import { drawAtlasScene } from "./lib/browser-sampler.mjs";
import { InputLabBridgeClient } from "./lib/bridge-client.mjs";
import { createInputLabProject, createOfflinePreviewDocument, serializeInputLabProject } from "./lib/browser-project.mjs";
import { browserHidAvailable, BrowserFramerSceneClient } from "./lib/browser-scene-hid.mjs";
import { confirmInputLabMQuickJsWeatherRender, deliverInputLabMQuickJsWeatherBatch,
  INPUT_LAB_MQUICKJS_PHYSICAL_WEATHER_TARGET } from "./lib/mquickjs-device-rpc.mjs";
import { BrowserKeyRpcBridge, normalizeKeyboardRpcConfig } from "./lib/browser-key-rpc.mjs";
import { BrowserKeyRpcDelivery } from "./lib/browser-key-rpc-delivery.mjs";
import { appendRenderV2PreviewEvent, createRenderV2ApiSource, createRenderV2PreviewEvent,
  drawRenderV2Frame, normalizeRenderV2Result, parseRenderV2HostRpcId } from "./lib/render-v2-browser.mjs";
import { RenderV2OperationGate } from "./lib/render-v2-operations.mjs";
import { InputLabMQuickJsKeySimulator } from "./lib/mquickjs-key-events.mjs";
import { assessInputLabMQuickJsPushGate, buildInputLabMQuickJsPackage,
  createInputLabDeterministicWeatherSnapshot, createInputLabWeatherRpcBatch,
  drawInputLabMQuickJsPreview, extractInputLabMQuickJsRasterBase,
  INPUT_LAB_MQUICKJS_STATUS, InputLabMQuickJsCanarySession,
  normalizeInputLabMQuickJsSettings } from "./lib/mquickjs-canary.mjs";
import timerCanarySource from "../examples/render-v2-mquickjs-canary/canary-widget.js?raw";
import weatherCanarySource from "../examples/render-v2-mquickjs-weather-canary/weather-widget.js?raw";
import weatherCanaryPackageUrl from "../examples/render-v2-mquickjs-weather-canary/build/weather-60601.f2js?url";

const elements = Object.freeze({ html: document.querySelector("#html-source"), css: document.querySelector("#css-source"),
  script: document.querySelector("#js-source"), scriptHeading: document.querySelector("#script-heading"),
  rendererNotice: document.querySelector("#render-v2-notice"), loadV2Example: document.querySelector("#load-v2-example"),
  canvas: document.querySelector("#preview"), browserPreview: document.querySelector("#browser-preview"),
  deviceFrame: document.querySelector(".device-frame"), previewStage: document.querySelector("#preview-stage"),
  status: document.querySelector("#status"), bridgeStatus: document.querySelector("#bridge-status"),
  active: document.querySelector("#active-slot"), slots: document.querySelector("#slot-list"),
  connectKeyboard: document.querySelector("#connect-keyboard"), flashRenderer: document.querySelector("#flash-renderer"),
  usbStatus: document.querySelector("#usb-status"),
  apply: document.querySelector("#apply"), export: document.querySelector("#export"),
  applyProgress: document.querySelector("#apply-progress"),
  applyProgressText: document.querySelector("#apply-progress-text"),
  rendererVersion: document.querySelector("#renderer-version"), mode: document.querySelector("#mode"),
  v2Backend: document.querySelector("#v2-backend"), mquickJsExample: document.querySelector("#mquickjs-example"),
  loadMquickJsExample: document.querySelector("#load-mquickjs-example"),
  mquickJsDownload: document.querySelector("#mquickjs-download"),
  fps: document.querySelector("#fps"), duration: document.querySelector("#duration"),
  maxBytes: document.querySelector("#max-bytes"), interaction: document.querySelector("#interaction"),
  stats: document.querySelector("#capture-stats"), filmstrip: document.querySelector("#filmstrip"),
  v2Controls: document.querySelector("#render-v2-controls"), v2Reset: document.querySelector("#v2-reset"),
  v2Tick100: document.querySelector("#v2-tick-100"), v2Tick1s: document.querySelector("#v2-tick-1s"),
  v2KnobDown: document.querySelector("#v2-knob-down"), v2KnobUp: document.querySelector("#v2-knob-up"),
  v2HostId: document.querySelector("#v2-host-id"), v2HostValue: document.querySelector("#v2-host-value"),
  v2HostSend: document.querySelector("#v2-host-send"), v2EventStatus: document.querySelector("#v2-event-status"),
  v2State: document.querySelector("#v2-state"), v2Budget: document.querySelector("#v2-budget"),
  v2DeviceSupport: document.querySelector("#v2-device-support"), v2KeyCode: document.querySelector("#v2-key-code"),
  v2KeyRpcId: document.querySelector("#v2-key-rpc-id"), v2KeyPad: document.querySelector("#v2-key-pad"),
  v2KeyStatus: document.querySelector("#v2-key-status"),
  mquickJsControls: document.querySelector("#mquickjs-controls"), mqKey0Down: document.querySelector("#mq-key0-down"),
  mqKey0Up: document.querySelector("#mq-key0-up"), mqKey1Down: document.querySelector("#mq-key1-down"),
  mqKey1Up: document.querySelector("#mq-key1-up"), mqKeyHold: document.querySelector("#mq-key-hold"),
  mqChord: document.querySelector("#mq-chord"), mqHostId: document.querySelector("#mq-host-id"),
  mqHostValue: document.querySelector("#mq-host-value"), mqHostAux: document.querySelector("#mq-host-aux"),
  mqHostSend: document.querySelector("#mq-host-send"), mqWeatherSettings: document.querySelector("#mq-weather-settings"),
  mqZip: document.querySelector("#mq-zip"), mqUnits: document.querySelector("#mq-units"),
  mqWeatherRefresh: document.querySelector("#mq-weather-refresh"), mqKeyPad: document.querySelector("#mq-key-pad"),
  f2epHostRow: document.querySelector("#f2ep-host-row"), f2epKeyConfig: document.querySelector("#f2ep-key-config"),
  f2epKeyNote: document.querySelector("#f2ep-key-note") });
const store = new SavedPreviewStore({ storage: localStorage });
let state = store.load();
let lastCompilation = null;
let animationStart = performance.now();
let rasterFrames = [];
let rasterFrameMs = 200;
let bridge = null;
let browserDevice = null;
let applyBusy = false;
let autosaveTimer = null;
let renderV2Events = Object.freeze([]);
let renderV2Busy = false;
let renderV2DeviceCapability = null;
let mquickJsDeviceCapability = null;
let keyboardBridge = null;
let keyboardRpcDelivery = null;
let renderV2Operations = null;
let mquickJsCompilation = null;
let mquickJsSession = null;
let mquickJsKeySimulator = null;
let mquickJsClock = 0;
let mquickJsRpcRevision = 0;
let weatherRasterBasePromise = null;
let zipSyncPushTimer = null;

function fitPreviewStage() {
  const frameStyle = getComputedStyle(elements.deviceFrame);
  const horizontalPadding = Number.parseFloat(frameStyle.paddingLeft) + Number.parseFloat(frameStyle.paddingRight);
  const availableWidth = Math.max(1, elements.deviceFrame.clientWidth - horizontalPadding);
  const frameTop = elements.deviceFrame.getBoundingClientRect().top;
  const availableHeight = Math.max(1, window.innerHeight - frameTop - 110);
  const scale = Math.max(0.25, Math.min(2, availableWidth / 100, availableHeight / 310));
  elements.previewStage.style.setProperty("--preview-scale", String(scale));
}

const previewResizeObserver = new ResizeObserver(fitPreviewStage);
previewResizeObserver.observe(elements.deviceFrame);
window.addEventListener("resize", fitPreviewStage);
fitPreviewStage();

function animate(now) {
  if (lastCompilation?.scene) drawAtlasScene(elements.canvas, lastCompilation.scene, lastCompilation.atlas,
    Math.floor((now - animationStart) / lastCompilation.scene.tickMs));
  else if (rasterFrames.length) {
    const image = rasterFrames[Math.floor((now - animationStart) / rasterFrameMs) % rasterFrames.length];
    if (image?.complete) elements.canvas.getContext("2d").drawImage(image, 0, 0, 100, 310);
  }
  requestAnimationFrame(animate);
}

function progressLabel(event) {
  if (event.stage === "compiling-slots") {
    return event.current > 0 ? `Compiling slots ${event.current}/${event.total}` : "Compiling slots";
  }
  if (event.stage === "encoding-bundle") return "Encoding bundle";
  if (event.stage === "uploading-chunks") return `Uploading chunks ${event.current}/${event.total}`;
  if (event.stage === "applying-on-keyboard") return "Applying on keyboard";
  if (event.stage === "done") return "Done";
  return "Working";
}

function showApplyProgress(text, state = "busy") {
  elements.applyProgress.hidden = false;
  elements.applyProgress.dataset.state = state;
  elements.applyProgressText.textContent = text;
}

function setApplyBusy(value) {
  applyBusy = value;
  const activeRenderV2 = elements.rendererVersion.value === "v2";
  const activeMquickJs = activeRenderV2 && elements.v2Backend.value === "mquickjs";
  const mixedV1Project = !activeRenderV2 && projectContainsRenderV2();
  const renderV2Blocked = activeRenderV2 && !renderV2DeviceCapability;
  const renderV1Blocked = !activeRenderV2 && browserDevice?.renderV2CapabilityStatus === "generic-incompatible";
  const keyPressed = keyboardBridge?.pressed === true;
  elements.apply.disabled = activeMquickJs || value || renderV2Busy || keyPressed || !bridge || !browserDevice ||
    mixedV1Project || renderV2Blocked || renderV1Blocked;
  elements.apply.setAttribute("aria-busy", String(value));
  elements.apply.textContent = value ? "Applying…" : activeMquickJs ? "Push unavailable"
    : activeRenderV2 && renderV2DeviceCapability ? "Apply V2 to ID26"
      : renderV2Blocked || mixedV1Project || renderV1Blocked ? "Push unavailable" : "Apply / Push";
  elements.apply.title = activeMquickJs
    ? "Package Push is intentionally blocked for the boot-lifetime MicroQuickJS canary (runtimeUploader=false); connected ID28 host-event testing remains available"
    : !bridge ? "Wait for the Input Lab compiler service"
    : !browserDevice ? "Connect the keyboard over WebHID to enable Push"
      : keyPressed ? "Release the browser key before changing or applying the widget"
      : mixedV1Project ? "Render v1 Push requires all three saved previews to remain Render v1"
        : renderV1Blocked ? "Generic firmware did not explicitly advertise V1 package admission"
        : renderV2Blocked
          ? "Preview works, but the connected firmware does not advertise generic Render v2 package admission"
      : activeRenderV2 ? "Compile the active preset and apply its Render v2 package to widget ID26"
        : "Compile all three Render v1 slots and push them to the connected keyboard";
}

function decodeBase64(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function request(path, body) {
  if (!bridge) throw new Error("Native compile and keyboard Push require the Input Lab compiler service.");
  const response = await bridge.request(path, body);
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(`${result.error}: ${result.message}`), { code: result.error });
  return result;
}

function showOfflinePreview(source) {
  elements.browserPreview.srcdoc = createOfflinePreviewDocument({ ...source,
    interaction: source.settings?.interaction ?? "none" });
  elements.browserPreview.hidden = false;
  elements.canvas.hidden = true;
  elements.filmstrip.replaceChildren();
  elements.stats.replaceChildren();
  rasterFrames = [];
  lastCompilation = Object.freeze({ mode: "browser" });
  elements.status.value = source.renderer === "v2"
    ? "Static HTML/CSS only · Render v2 event compilation requires the compiler service"
    : "Browser preview · saved locally · project export ready · compiler unavailable";
  if (source.renderer === "v2") elements.v2EventStatus.value = "Compiler unavailable · widget JS was not executed.";
  return lastCompilation;
}

function replaceKeyValues(container, entries) {
  container.replaceChildren();
  for (const [label, value] of entries) {
    const term = document.createElement(container.tagName === "DL" ? "dt" : "span");
    term.textContent = container.tagName === "DL" ? label : `${label}: ${value}`;
    container.append(term);
    if (container.tagName === "DL") {
      const definition = document.createElement("dd");
      definition.textContent = String(value);
      container.append(definition);
    }
  }
}

function showRenderV2Result(result, eventLabel = "Compiled") {
  const compiled = normalizeRenderV2Result(result);
  lastCompilation = compiled;
  rasterFrames = [];
  elements.browserPreview.hidden = true;
  elements.canvas.hidden = false;
  elements.filmstrip.replaceChildren();
  elements.stats.replaceChildren();
  drawRenderV2Frame(elements.canvas, compiled.frameBase64);
  replaceKeyValues(elements.v2State, Object.entries(compiled.state));
  const budget = compiled.budget;
  const rasterProof = compiled.manifest?.scene?.proof;
  const renderSource = compiled.renderMode === "raster"
    ? `Chromium raster · ${rasterProof?.freshRenders ?? "?"} fresh-render proofs`
    : "Semantic CSS";
  replaceKeyValues(elements.v2Budget, [
    ["render", renderSource],
    ["states", budget.states], ["handlers", budget.handlers], ["bindings", budget.bindings],
    ["variants", budget.variants], ["spans", budget.spans], ["patch bytes", budget.pixelBytes],
    ["program", `${compiled.programBytes} B`], ["package", `${compiled.packageBytes} B`],
  ]);
  const applied = Number.isInteger(compiled.eventsApplied) ? ` · ${compiled.eventsApplied} events` : "";
  const changed = Number.isInteger(compiled.changedPixels) ? ` · ${compiled.changedPixels} px changed` : "";
  elements.v2EventStatus.value = `${eventLabel}${applied}${changed} · sequence ${renderV2Events.length}/64`;
  const pushReason = renderV2DeviceCapability ? "connected generic renderer can apply this package to ID26"
    : compiled.push?.reason ?? "custom Render v2 device Push is unavailable on this firmware";
  elements.status.value = `Render v2 · ${renderSource} · ${compiled.packageBytes} bytes · ${compiled.sha256.slice(0, 12)} · ${pushReason}`;
  return compiled;
}

async function compileRenderV2(source) {
  const revision = renderV2Operations.revision;
  const apiSource = createRenderV2ApiSource({ ...source, name: state.slots[state.activeSlot].name });
  return renderV2Operations.run("compile", async ({ assertCurrent }) => {
    elements.v2EventStatus.value = "Compiling bounded event program…";
    const result = await request("/api/render-v2/compile", apiSource);
    assertCurrent();
    renderV2Events = Object.freeze([]);
    return showRenderV2Result(result);
  }, { revision });
}

async function weatherRasterBase() {
  if (!weatherRasterBasePromise) weatherRasterBasePromise = fetch(weatherCanaryPackageUrl)
    .then((response) => {
      if (!response.ok) throw new Error("Bundled weather F2JS fixture is unavailable.");
      return response.arrayBuffer();
    }).then((value) => extractInputLabMQuickJsRasterBase(new Uint8Array(value)));
  return weatherRasterBasePromise;
}

function mquickJsSettings() {
  return normalizeInputLabMQuickJsSettings({ example: elements.mquickJsExample.value,
    postalCode: elements.mqZip.value, units: elements.mqUnits.value, countryCode: "US" });
}

// Shares f1-widget-sdk/build/zip-sync-config.json with tools/zip-sync.mjs so a
// ZIP saved from the physical knob shows up here, and a ZIP typed here is
// what zip-sync.mjs pushes to the device on its next boot. Best-effort: a
// hosted or disconnected bridge simply leaves the ZIP field as it was.
async function syncZipFieldFromBridge() {
  if (!bridge) return;
  try {
    const config = await bridge.getZipSyncConfig();
    if (!config) return;
    elements.mqZip.value = config.postalCode;
    elements.mqUnits.value = config.units;
  } catch { /* Best-effort: keep whatever ZIP was already loaded from the saved slot. */ }
}

function scheduleZipSyncConfigPush() {
  if (zipSyncPushTimer !== null) clearTimeout(zipSyncPushTimer);
  zipSyncPushTimer = setTimeout(() => {
    zipSyncPushTimer = null;
    if (!bridge) return;
    const settings = mquickJsSettings();
    request("/api/zip-sync/config", { postalCode: settings.postalCode, countryCode: settings.countryCode,
      units: settings.units }).catch(() => { /* Best-effort: local editing still works offline. */ });
  }, 400);
}

function showMquickJsSnapshot(label = "Compiled") {
  const snapshot = mquickJsSession.snapshot();
  drawInputLabMQuickJsPreview(elements.canvas, snapshot);
  replaceKeyValues(elements.v2State, Object.entries(snapshot)
    .filter(([, value]) => typeof value !== "object").slice(0, 12));
  elements.v2EventStatus.value = `${label} · ${snapshot.lastEvent} · ${snapshot.eventCount} fixture events`;
}

async function compileMquickJs(source) {
  elements.v2EventStatus.value = "Building strict F2JS locally…";
  const settings = mquickJsSettings();
  const rasterBase = settings.example === "weather" ? await weatherRasterBase() : null;
  const compiled = await buildInputLabMQuickJsPackage({ source: source.script,
    example: settings.example, rasterBase });
  mquickJsCompilation = compiled;
  lastCompilation = Object.freeze({ mode: "mquickjs", ...compiled });
  elements.script.value = compiled.source;
  mquickJsSession = new InputLabMQuickJsCanarySession(settings);
  mquickJsKeySimulator = new InputLabMQuickJsKeySimulator({
    keys: [{ id: 0, browserCode: "KeyF" }, { id: 1, browserCode: "KeyT" }],
    chords: [{ id: 0, heldMask: 3 }], debounceMs: 10, holdDelayMs: 500, holdCadenceMs: 100,
  });
  mquickJsClock = 0;
  if (settings.example === "weather") mquickJsSession.refreshWeather();
  elements.browserPreview.hidden = true;
  elements.canvas.hidden = false;
  elements.filmstrip.replaceChildren();
  elements.stats.replaceChildren();
  replaceKeyValues(elements.v2Budget, [
    ["status", INPUT_LAB_MQUICKJS_STATUS],
    ["package", `${compiled.budget.packageBytes}/${98_304} B`],
    ["source", `${compiled.budget.sourceBytes}/${8_192} B`],
    ["heap", `${compiled.budget.heapBytes}/${65_536} B`],
    ["handlers", `${compiled.budget.handlers}/16`], ["targets", `${compiled.budget.targets}/16`],
    ["keys", `${compiled.budget.keys}/16`], ["chords", `${compiled.budget.chords}/8`],
  ]);
  elements.mquickJsDownload.disabled = false;
  const gate = assessInputLabMQuickJsPushGate({ capability: mquickJsDeviceCapability, uploader: null });
  elements.status.value = `${INPUT_LAB_MQUICKJS_STATUS} · F2JS ${compiled.bytes} B · ${compiled.sha256.slice(0, 12)} · Push blocked: ${gate.reason}`;
  showMquickJsSnapshot("Compiled");
  return compiled;
}

async function compile() {
  elements.status.value = "Compiling…";
  const source = currentSource();
  if (source.renderer === "v2" && source.backend === "mquickjs") return compileMquickJs(source);
  if (!bridge) return showOfflinePreview(source);
  if (source.renderer === "v2") return compileRenderV2(source);
  let autoFallback = false;
  let result;
  if (elements.mode.value === "raster") result = await request("/api/capture", source);
  else {
    try { result = await request("/api/compile", source); }
    catch (error) {
      if (elements.mode.value !== "auto" || error?.code !== "INPUT_LAB_SEMANTIC_UNSUPPORTED") throw error;
      elements.status.value = "Browser CSS detected · capturing frames…";
      result = await request("/api/capture", source);
      autoFallback = true;
    }
  }
  lastCompilation = result;
  elements.browserPreview.hidden = true;
  elements.canvas.hidden = false;
  animationStart = performance.now();
  elements.filmstrip.replaceChildren();
  elements.stats.replaceChildren();
  if (result.mode === "raster") {
    rasterFrameMs = result.settings.cadenceMs;
    rasterFrames = result.pngFrames.map((base64, index) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      image.alt = `Captured frame ${index + 1}`;
      elements.filmstrip.append(image.cloneNode());
      return image;
    });
    const changed = result.stats.changedPixels.slice(1);
    const percent = changed.length ? changed.reduce((sum, value) => sum + value, 0) / changed.length / 310 : 0;
    const entries = [["frames", `${result.stats.frameCount}/${result.requestedFrameCount}`],
      ["changed", `${percent.toFixed(1)}%`], ["raw", `${result.stats.rawBytes} B`],
      ["encoded", `${result.stats.encodedBytes} B`], ["headroom", `${result.stats.headroomBytes} B`],
      ["fit", result.reduced ? "auto-reduced" : "exact"]];
    for (const [label, value] of entries) { const item = document.createElement("span"); item.textContent = `${label}: ${value}`; elements.stats.append(item); }
  } else {
    rasterFrames = [];
    drawAtlasScene(elements.canvas, result.scene, result.atlas, 0);
  }
  const route = autoFallback ? "Auto → Chromium raster · " : "";
  elements.status.value = `${route}${result.bytes ?? result.binaryBytes} bytes · ${result.sha256.slice(0, 12)}`;
  return result;
}

function settingsFromInputs() {
  return { fps: Number(elements.fps.value), loopDurationMs: Number(elements.duration.value),
    maxFrames: Math.min(60, Math.max(1, Math.round(Number(elements.duration.value) * Number(elements.fps.value) / 1000))),
    maxBytes: Number(elements.maxBytes.value), interaction: elements.interaction.value };
}

function currentSource() {
  return { renderer: elements.rendererVersion.value, backend: elements.v2Backend.value, mode: elements.mode.value,
    html: elements.html.value, css: elements.css.value, script: elements.script.value,
    settings: settingsFromInputs(), eventConfig: { keyboardCode: elements.v2KeyCode.value,
      keyboardRpcId: elements.v2KeyRpcId.value }, mquickjs: mquickJsSettings() };
}

function persistCurrentSlot({ compiled = null } = {}) {
  const active = state.slots[state.activeSlot];
  state = store.saveSlot(state.activeSlot, { name: active.name, ...currentSource(), compiled });
  return state;
}

function flushAutosave() {
  if (autosaveTimer !== null) {
    clearTimeout(autosaveTimer);
    autosaveTimer = null;
  }
  return persistCurrentSlot();
}

function scheduleAutosave() {
  if (autosaveTimer !== null) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    autosaveTimer = null;
    persistCurrentSlot();
  }, 200);
}

function compactCompilation(result) {
  if (!result || result.mode === "browser") return null;
  if (result.mode === "render-v2") return { mode: "render-v2", sha256: result.sha256,
    packageBytes: result.packageBytes, programBytes: result.programBytes,
    programSha256: result.programSha256, renderMode: result.renderMode,
    renderSource: result.renderSource, rasterProof: result.rasterProof,
    budget: result.budget, push: result.push };
  if (result.mode === "raster") return { mode: "raster", sha256: result.sha256, bytes: result.bytes,
    animationBase64: result.animationBase64, stats: result.stats, settings: result.settings };
  return { mode: "semantic", sha256: result.sha256, binaryBytes: result.binaryBytes,
    binaryBase64: result.binaryBase64, atlas: result.atlas };
}

function syncRendererUi() {
  const renderV2 = elements.rendererVersion.value === "v2";
  const mquickjs = renderV2 && elements.v2Backend.value === "mquickjs";
  for (const setting of document.querySelectorAll(".v1-setting")) setting.hidden = renderV2;
  for (const setting of document.querySelectorAll(".v2-setting")) setting.hidden = !renderV2;
  for (const setting of document.querySelectorAll(".f2ep-setting")) setting.hidden = mquickjs;
  elements.scriptHeading.hidden = !renderV2;
  elements.script.hidden = !renderV2;
  elements.rendererNotice.hidden = !renderV2;
  elements.v2Controls.hidden = !renderV2;
  elements.loadV2Example.hidden = mquickjs;
  elements.mquickJsExample.hidden = !mquickjs;
  elements.loadMquickJsExample.hidden = !mquickjs;
  elements.mquickJsDownload.hidden = !mquickjs;
  elements.mquickJsControls.hidden = !mquickjs;
  elements.mqWeatherSettings.hidden = !mquickjs || elements.mquickJsExample.value !== "weather";
  elements.f2epHostRow.hidden = mquickjs;
  elements.f2epKeyConfig.hidden = mquickjs;
  elements.v2KeyPad.hidden = mquickjs;
  elements.v2KeyStatus.hidden = mquickjs;
  elements.f2epKeyNote.hidden = mquickjs;
  elements.rendererNotice.textContent = mquickjs
    ? mquickJsDeviceCapability
      ? "Strict F2JS source is packaged locally and never run as jsdom. Physical ID28 executes JavaScript and accepts serialized fixture weather RPC; Package Push remains blocked (uploader=false)."
      : "Strict F2JS source is packaged locally and never run as jsdom. Fixture controls model events; connect the physical ID28 canary to probe its device runtime."
    : "Safe SDK subset: integer state and bounded DOM updates are compiled to F2EP bytecode. Source is parsed, never executed as arbitrary JavaScript or jsdom.";
  if (renderV2 && renderV2Events.length === 0 && lastCompilation?.mode !== "render-v2") {
    elements.v2EventStatus.value = "Compile to begin deterministic event simulation.";
    elements.v2State.replaceChildren();
    elements.v2Budget.replaceChildren();
  }
  setApplyBusy(applyBusy);
}

function updateRenderV2DeviceSupport() {
  if (elements.rendererVersion.value === "v2" && elements.v2Backend.value === "mquickjs") {
    const gate = assessInputLabMQuickJsPushGate({ capability: mquickJsDeviceCapability, uploader: null });
    const ready = Boolean(mquickJsDeviceCapability && browserDevice);
    elements.v2DeviceSupport.dataset.state = ready ? "ready" : "blocked";
    elements.v2DeviceSupport.textContent = ready
      ? `Physical canary ID28 · JS on device · keys ${mquickJsDeviceCapability.keyEvents ? "ready" : "gated"} · proven=false · uploader=false · host RPC ready · Package Push blocked`
      : `STATIC/OFFLINE · Push blocked · ${gate.reason}`;
    setApplyBusy(applyBusy);
    return;
  }
  const ready = Boolean(renderV2DeviceCapability && browserDevice);
  elements.v2DeviceSupport.dataset.state = ready ? "ready" : "blocked";
  const incompatible = browserDevice?.renderV2CapabilityStatus === "generic-incompatible";
  elements.v2DeviceSupport.textContent = ready
    ? `Device ID26 ready · gen ${renderV2DeviceCapability.committedGeneration} · ${renderV2DeviceCapability.maxBundleBytes / 1024} KiB`
    : incompatible ? "Push blocked · incompatible generic capability"
      : "Preview only · generic V2 capability not detected";
  const forwarding = ready ? "device forwarding ready" : "device forwarding unavailable";
  if (!keyboardBridge?.pressed) {
    elements.v2KeyStatus.value = `Browser key → host RPC · down 1 / up 0 · ${forwarding}`;
  }
  setApplyBusy(applyBusy);
}

function loadSlot(slot) {
  renderV2Operations?.invalidate("saved preview loaded");
  elements.html.value = slot.html;
  elements.css.value = slot.css;
  elements.script.value = slot.script ?? "";
  elements.rendererVersion.value = slot.renderer === "v2" ? "v2" : "v1";
  elements.v2Backend.value = slot.backend === "mquickjs" ? "mquickjs" : "f2ep";
  elements.mode.value = slot.mode ?? "auto";
  const settings = { ...DEFAULT_RASTER_SETTINGS, ...(slot.settings ?? {}) };
  elements.fps.value = settings.fps;
  elements.duration.value = settings.loopDurationMs;
  elements.maxBytes.value = settings.maxBytes;
  elements.interaction.value = settings.interaction;
  elements.v2KeyCode.value = slot.eventConfig?.keyboardCode ?? "Space";
  elements.v2KeyRpcId.value = slot.eventConfig?.keyboardRpcId ?? "0xB201";
  const mquickjs = normalizeInputLabMQuickJsSettings(slot.mquickjs);
  elements.mquickJsExample.value = mquickjs.example;
  elements.mqZip.value = mquickjs.postalCode;
  elements.mqUnits.value = mquickjs.units;
  renderV2Events = Object.freeze([]);
  syncRendererUi();
}

function renderSlots() {
  elements.slots.replaceChildren();
  state.slots.forEach((slot, index) => {
    const row = document.createElement("div");
    row.className = `slot${state.activeSlot === index ? " active" : ""}`;
    const name = document.createElement("input");
    name.value = slot.name;
    name.maxLength = 32;
    name.setAttribute("aria-label", `Preview ${index + 1} name`);
    name.addEventListener("input", () => {
      state = store.renameSlot(index, name.value);
      if (state.activeSlot === index && elements.rendererVersion.value === "v2") {
        renderV2Operations.invalidate("active preview name changed");
      }
      if (state.activeSlot === index) elements.active.textContent = `Active slot: ${index + 1} · ${state.slots[index].name}`;
    });
    const renderer = document.createElement("span");
    renderer.className = "slot-renderer";
    renderer.textContent = slot.renderer === "v2" ? "Render v2 · event program" : "Render v1 · HTML/CSS";
    const actions = document.createElement("div");
    actions.className = "slot-actions";
    const load = document.createElement("button");
    load.textContent = "Load";
    load.addEventListener("click", async () => {
      flushAutosave();
      state = store.setActive(index);
      loadSlot(state.slots[index]);
      renderSlots();
      await compile().catch(showError);
    });
    const save = document.createElement("button");
    save.textContent = "Save";
    save.addEventListener("click", () => {
      if (autosaveTimer !== null) {
        clearTimeout(autosaveTimer);
        autosaveTimer = null;
      }
      state = store.saveSlot(index, { name: name.value, ...currentSource(), compiled: compactCompilation(lastCompilation) });
      renderSlots();
      elements.status.value = `Saved preview ${index + 1}`;
    });
    actions.append(load, save);
    row.append(name, renderer, actions);
    elements.slots.append(row);
  });
  const slot = state.slots[state.activeSlot];
  elements.active.textContent = `Active slot: ${state.activeSlot + 1} · ${slot.name}`;
  setApplyBusy(applyBusy);
}

function showError(error) {
  if (error?.code === "RENDER_V2_STALE_OPERATION") return;
  elements.status.value = error.message;
}

function currentProjectSlots() {
  return state.slots.map((slot, index) => index === state.activeSlot ? { ...slot, ...currentSource() } : slot);
}

function projectContainsRenderV2() {
  return currentProjectSlots().some((slot) => slot.renderer === "v2");
}

function exportProject() {
  flushAutosave();
  const project = createInputLabProject({ slots: currentProjectSlots(), activeSlot: state.activeSlot });
  const blob = new Blob([serializeInputLabProject(project)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "input-lab-project.json";
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  elements.status.value = "Exported three-preview Input Lab project";
}

async function connectBridge() {
  try {
    const client = new InputLabBridgeClient();
    await client.connect();
    bridge = client;
    elements.bridgeStatus.dataset.state = "ready";
    elements.bridgeStatus.textContent = "Compiler: ready";
    setApplyBusy(applyBusy);
    await syncZipFieldFromBridge();
    await compile();
  } catch (error) {
    bridge = null;
    elements.bridgeStatus.dataset.state = "blocked";
    elements.bridgeStatus.textContent = "Compiler: unavailable";
    elements.bridgeStatus.title = error instanceof Error ? error.message : String(error);
    setApplyBusy(false);
  }
}

async function connectKeyboard() {
  if (!browserHidAvailable()) throw new Error("WebHID requires desktop Chrome or Edge on localhost or HTTPS.");
  elements.usbStatus.textContent = "Waiting for the Framer chooser…";
  const client = await BrowserFramerSceneClient.connect();
  browserDevice = client;
  try { renderV2DeviceCapability = await client.probeRenderV2Capabilities({ force: true }); }
  catch { renderV2DeviceCapability = null; }
  try { mquickJsDeviceCapability = await client.probeMQuickJsCapabilities({ force: true }); }
  catch { mquickJsDeviceCapability = null; }
  mquickJsRpcRevision = 0;
  elements.connectKeyboard.disabled = true;
  elements.flashRenderer.disabled = !("serial" in navigator) || Boolean(mquickJsDeviceCapability);
  elements.flashRenderer.title = mquickJsDeviceCapability
    ? "Disabled for the MicroQuickJS canary: use the approval-bound external multi-region workflow"
    : "Flash the catalog renderer app";
  const v2Status = renderV2DeviceCapability
    ? `generic V2 ID26 ready · gen ${renderV2DeviceCapability.committedGeneration} · chunks ${renderV2DeviceCapability.chunkRawBytes} × ${renderV2DeviceCapability.maxChunks}`
    : client.renderV2CapabilityStatus === "generic-incompatible"
      ? "Push blocked · generic capability contract mismatch"
      : "V2 preview only · generic capability not detected";
  const mqStatus = mquickJsDeviceCapability
    ? `MicroQuickJS physical ID28 ready · JS=${Number(mquickJsDeviceCapability.deviceEvaluatesJavaScript)} · keys=${Number(mquickJsDeviceCapability.keyEvents)} · proven=0 · uploader=0`
    : "MicroQuickJS canary not detected";
  elements.usbStatus.textContent = `Connected · firmware 0.4.1 · ${v2Status} · ${mqStatus} · serial ${client.device.serialNumber}`;
  updateRenderV2DeviceSupport();
  syncRendererUi();
}

async function flashRenderer() {
  if (!browserDevice) throw new Error("Connect the keyboard before flashing.");
  if (mquickJsDeviceCapability) {
    throw new Error("Input Lab will not replace the MicroQuickJS canary with the unrelated catalog renderer. Use the guarded external multi-region workflow.");
  }
  if (!window.confirm("Flash the smoke-approved renderer app at 0x10000? This does not erase NVS or the filesystem.")) return;
  const { flashInputLabRenderer, resolveInputLabFlashIdentity } = await import("./lib/browser-flash.mjs");
  const device = browserDevice.device;
  const normalIdentity = await resolveInputLabFlashIdentity(device);
  let singleDeviceConfirmed = false;
  if (normalIdentity.mode === "single-device") {
    singleDeviceConfirmed = window.confirm("Chrome did not expose a serial number. Confirm that exactly one Framer F1 / Knob F1 is connected before selecting its bootloader port.");
    if (!singleDeviceConfirmed) return;
  }
  elements.flashRenderer.disabled = true;
  elements.connectKeyboard.disabled = true;
  await keyboardBridge?.release("device-disconnect").catch(() => {});
  await browserDevice.close();
  browserDevice = null;
  renderV2DeviceCapability = null;
  mquickJsDeviceCapability = null;
  updateRenderV2DeviceSupport();
  syncRendererUi();
  setApplyBusy(false);
  elements.usbStatus.textContent = "Preparing bootloader…";
  const receipt = await flashInputLabRenderer({ device, normalIdentity, singleDeviceConfirmed,
    onProgress: (written, total) => { elements.usbStatus.textContent = `Flashing app ${Math.round(written / total * 100)}%…`; },
    onLog: (line) => { if (line) elements.status.value = line; } });
  elements.usbStatus.textContent = `Flash complete · device healthy · ${receipt.app.sha256.slice(0, 12)}`;
  elements.connectKeyboard.disabled = false;
}

function setRenderV2Busy(value) {
  renderV2Busy = value;
  const locked = value || keyboardBridge?.pressed === true;
  for (const control of [elements.v2Reset, elements.v2Tick100, elements.v2Tick1s,
    elements.v2KnobDown, elements.v2KnobUp, elements.v2HostSend, elements.v2HostId,
    elements.v2HostValue, elements.v2KeyCode, elements.v2KeyRpcId, elements.loadV2Example]) control.disabled = locked;
  for (const control of [elements.html, elements.css, elements.script, elements.rendererVersion,
    elements.mode, document.querySelector("#compile")]) control.disabled = locked;
  for (const control of elements.slots.querySelectorAll("button, input")) control.disabled = locked;
  elements.v2KeyPad.setAttribute("aria-disabled", String(locked));
  elements.v2Controls.setAttribute("aria-busy", String(value));
  setApplyBusy(applyBusy);
}

renderV2Operations = new RenderV2OperationGate({ onBusyChange: (busy) => setRenderV2Busy(busy) });

async function dispatchRenderV2Event(event, label, { forwardHost = false,
  statusTarget = elements.v2EventStatus } = {}) {
  if (elements.rendererVersion.value !== "v2") throw new Error("Select Render v2 before simulating events.");
  if (!bridge) throw new Error("Render v2 event simulation requires the Input Lab compiler service.");
  const revision = renderV2Operations.revision;
  const sourceSnapshot = { ...currentSource(), name: state.slots[state.activeSlot].name };
  return renderV2Operations.run("simulate", async ({ assertCurrent }) => {
    const previous = renderV2Events;
    const canonicalEvent = createRenderV2PreviewEvent({ kind: event.kind, id: event.id,
      value: event.value, sequence: previous.length + 1 });
    const next = appendRenderV2PreviewEvent(previous, canonicalEvent);
    statusTarget.value = `Applying ${label}…`;
    const source = createRenderV2ApiSource(sourceSnapshot, next);
    const result = await request("/api/render-v2/simulate", source);
    assertCurrent();
    renderV2Events = next;
    showRenderV2Result(result, label);
    if (forwardHost && browserDevice && renderV2DeviceCapability) {
      assertCurrent();
      await browserDevice.sendRenderV2HostEvent(canonicalEvent.id, canonicalEvent.value);
      assertCurrent();
      statusTarget.value = `${label} · preview accepted · forwarded to device ID26`;
      return Object.freeze({ result, event: canonicalEvent, forwarded: true });
    }
    if (forwardHost) statusTarget.value = `${label} · preview accepted · device forwarding unavailable`;
    return Object.freeze({ result, event: canonicalEvent, forwarded: false });
  }, { revision }).catch((error) => {
    if (error?.code !== "RENDER_V2_STALE_OPERATION") statusTarget.value = error.message;
    throw error;
  });
}

function nextRenderV2Event(options) {
  return createRenderV2PreviewEvent({ ...options, sequence: renderV2Events.length + 1 });
}

function loadRenderV2Example() {
  if (!window.confirm("Replace this preview's HTML, CSS, and widget JS with the bounded Render v2 event example?")) return;
  renderV2Operations.invalidate("Render v2 example loaded");
  elements.rendererVersion.value = "v2";
  elements.html.value = DEFAULT_RENDER_V2_HTML;
  elements.css.value = DEFAULT_RENDER_V2_CSS;
  elements.script.value = DEFAULT_RENDER_V2_SCRIPT;
  elements.v2KeyCode.value = "Space";
  elements.v2KeyRpcId.value = "0xB201";
  lastCompilation = null;
  renderV2Events = Object.freeze([]);
  syncRendererUi();
  scheduleAutosave();
  compile().catch(showError);
}

function loadMquickJsExample() {
  const example = elements.mquickJsExample.value;
  elements.rendererVersion.value = "v2";
  elements.v2Backend.value = "mquickjs";
  elements.script.value = example === "weather" ? weatherCanarySource :
    `"use strict";\n${timerCanarySource}`;
  elements.mqHostId.value = example === "weather" ? "0xB240" : "0x7001";
  mquickJsCompilation = null;
  lastCompilation = null;
  syncRendererUi();
  scheduleAutosave();
  compile().catch(showError);
}

function dispatchMquickJsEvent(event, label) {
  if (!mquickJsSession) throw new Error("Compile the MicroQuickJS canary before simulating events.");
  mquickJsSession.dispatch(event);
  showMquickJsSnapshot(label);
}

function drainMquickJsKeys(timestamp) {
  let result = mquickJsKeySimulator.drain(timestamp);
  for (const event of result.events) mquickJsSession.dispatch(event);
  while (result.morePending) {
    result = mquickJsKeySimulator.drain(timestamp);
    for (const event of result.events) mquickJsSession.dispatch(event);
  }
  showMquickJsSnapshot("Native input");
}

function mquickJsKeyLevel(key, pressed) {
  if (!mquickJsKeySimulator) throw new Error("Compile the MicroQuickJS canary before simulating keys.");
  mquickJsClock += 1;
  mquickJsKeySimulator.enqueueKey(key, pressed, mquickJsClock);
  drainMquickJsKeys(mquickJsClock);
  mquickJsClock += 10;
  drainMquickJsKeys(mquickJsClock);
}

function mquickJsChord() {
  mquickJsClock += 1;
  mquickJsKeySimulator.enqueueKey(0, true, mquickJsClock);
  mquickJsKeySimulator.enqueueKey(1, true, mquickJsClock);
  drainMquickJsKeys(mquickJsClock + 10);
  mquickJsClock += 11;
}

function downloadMquickJs() {
  if (!mquickJsCompilation) return;
  const blob = new Blob([mquickJsCompilation.binary], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${elements.mquickJsExample.value}-canary.f2js`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  elements.status.value = `Downloaded exact F2JS · ${mquickJsCompilation.sha256}`;
}

function markSourceEdited() {
  scheduleAutosave();
  if (elements.rendererVersion.value !== "v2") return;
  renderV2Operations.invalidate("Render v2 source changed");
  renderV2Events = Object.freeze([]);
  lastCompilation = null;
  elements.v2EventStatus.value = "Source changed · compile before simulating events.";
  elements.v2State.replaceChildren();
  elements.v2Budget.replaceChildren();
  setApplyBusy(applyBusy);
}

async function dispatchKeyboardRpcLevel({ id, value, code, phase, reason, synthetic }) {
  const label = `${code} ${phase}${synthetic ? ` (${reason})` : ""}`;
  const delivered = await keyboardRpcDelivery.deliver({ id, value, code, phase, reason, synthetic, label });
  if (delivered.cleanupFallback) {
    elements.v2KeyStatus.value = `${label} · preview became stale · zero-level cleanup forwarded to device ID26`;
  }
}

keyboardRpcDelivery = new BrowserKeyRpcDelivery({
  getTarget: () => browserDevice && renderV2DeviceCapability
    ? Object.freeze({ client: browserDevice, capability: renderV2DeviceCapability }) : null,
  dispatchPreview: (payload) => dispatchRenderV2Event(
    nextRenderV2Event({ kind: "host.rpc", id: payload.id, value: payload.value }), payload.label,
    { forwardHost: true, statusTarget: elements.v2KeyStatus }),
});

keyboardBridge = new BrowserKeyRpcBridge({
  element: elements.v2KeyPad,
  getConfig: () => {
    if (renderV2Operations.busy) throw new Error("Wait for the active Render v2 operation to finish.");
    if (renderV2Events.length > 62) throw new Error("Reset the simulation before another keyboard down/up pair.");
    return normalizeKeyboardRpcConfig({ code: elements.v2KeyCode.value, rpcId: elements.v2KeyRpcId.value });
  },
  onEvent: async (payload) => {
    try { await dispatchKeyboardRpcLevel(payload); }
    catch (error) {
      if (error?.code !== "RENDER_V2_STALE_OPERATION") elements.v2KeyStatus.value = error.message;
      throw error;
    }
  },
  onStatus: (payload) => {
    setRenderV2Busy(renderV2Busy);
    if (payload.error) elements.v2KeyStatus.value = payload.error.message;
    else elements.v2KeyStatus.value = `${payload.code} ${payload.phase} · updating preview…`;
  },
});

async function handleBrowserKeyboardDisconnect(event) {
  if (!browserDevice || event?.device !== browserDevice.device) return;
  try { await keyboardBridge.release("device-disconnect"); }
  catch { /* The device is already gone; preview release was still attempted first. */ }
  browserDevice = null;
  renderV2DeviceCapability = null;
  mquickJsDeviceCapability = null;
  elements.connectKeyboard.disabled = false;
  elements.flashRenderer.disabled = true;
  elements.usbStatus.textContent = "Keyboard disconnected · reconnect to enable device Push";
  updateRenderV2DeviceSupport();
  syncRendererUi();
}

document.querySelector("#compile").addEventListener("click", () => compile().catch(showError));
elements.rendererVersion.addEventListener("change", () => {
  renderV2Operations.invalidate("renderer changed");
  renderV2Events = Object.freeze([]);
  lastCompilation = null;
  syncRendererUi();
  scheduleAutosave();
});
elements.v2Backend.addEventListener("change", () => {
  renderV2Operations.invalidate("Render v2 backend changed");
  lastCompilation = null;
  mquickJsCompilation = null;
  syncRendererUi();
  scheduleAutosave();
  compile().catch(showError);
});
elements.loadV2Example.addEventListener("click", loadRenderV2Example);
elements.loadMquickJsExample.addEventListener("click", loadMquickJsExample);
elements.mquickJsDownload.addEventListener("click", downloadMquickJs);
elements.mquickJsExample.addEventListener("change", () => { syncRendererUi(); scheduleAutosave(); });
elements.v2Reset.addEventListener("click", () => compile().catch(showError));
elements.v2Tick100.addEventListener("click", () => elements.v2Backend.value === "mquickjs"
  ? dispatchMquickJsEvent({ type: "tick.100ms", value: 1 }, "tick.100ms")
  : dispatchRenderV2Event(nextRenderV2Event({ kind: "tick.100ms", value: 1 }), "tick.100ms").catch(showError));
elements.v2Tick1s.addEventListener("click", () => elements.v2Backend.value === "mquickjs"
  ? dispatchMquickJsEvent({ type: "tick.1s", value: 1 }, "tick.1s")
  : dispatchRenderV2Event(nextRenderV2Event({ kind: "tick.1s", value: 1 }), "tick.1s").catch(showError));
elements.v2KnobDown.addEventListener("click", () => elements.v2Backend.value === "mquickjs"
  ? dispatchMquickJsEvent({ type: "input.fn-bottom-knob", delta: -1,
    heldMask: mquickJsKeySimulator?.snapshot().heldMask ?? 0 }, "Fn + bottom dial −1")
  : dispatchRenderV2Event(nextRenderV2Event({ kind: "input.fn-bottom-knob", value: -1 }), "Fn + bottom dial −1").catch(showError));
elements.v2KnobUp.addEventListener("click", () => elements.v2Backend.value === "mquickjs"
  ? dispatchMquickJsEvent({ type: "input.fn-bottom-knob", delta: 1,
    heldMask: mquickJsKeySimulator?.snapshot().heldMask ?? 0 }, "Fn + bottom dial +1")
  : dispatchRenderV2Event(nextRenderV2Event({ kind: "input.fn-bottom-knob", value: 1 }), "Fn + bottom dial +1").catch(showError));
elements.v2HostSend.addEventListener("click", () => {
  try {
    const id = parseRenderV2HostRpcId(elements.v2HostId.value);
    const value = Number(elements.v2HostValue.value);
    dispatchRenderV2Event(nextRenderV2Event({ kind: "host.rpc", id, value }),
      `host.rpc:0x${id.toString(16).toUpperCase()}`,
      { forwardHost: true, statusTarget: elements.v2EventStatus }).catch(showError);
  } catch (error) { showError(error); elements.v2EventStatus.value = error.message; }
});
elements.mqKey0Down.addEventListener("click", () => mquickJsKeyLevel(0, true));
elements.mqKey0Up.addEventListener("click", () => mquickJsKeyLevel(0, false));
elements.mqKey1Down.addEventListener("click", () => mquickJsKeyLevel(1, true));
elements.mqKey1Up.addEventListener("click", () => mquickJsKeyLevel(1, false));
elements.mqKeyHold.addEventListener("click", () => {
  mquickJsClock += 500;
  drainMquickJsKeys(mquickJsClock);
});
elements.mqChord.addEventListener("click", mquickJsChord);
elements.mqHostSend.addEventListener("click", async () => {
  try {
    const id = parseRenderV2HostRpcId(elements.mqHostId.value);
    const value = Number(elements.mqHostValue.value);
    const auxiliary = Number(elements.mqHostAux.value);
    const label = `host.rpc:0x${id.toString(16).toUpperCase()}`;
    dispatchMquickJsEvent({ type: "host.rpc", id, value, auxiliary }, label);
    if (browserDevice && mquickJsDeviceCapability) {
      const result = await browserDevice.sendMQuickJsHostEvent({ id, value, auxiliary,
        generation: mquickJsDeviceCapability.generation, revision: ++mquickJsRpcRevision });
      elements.v2EventStatus.value = `${label} · preview accepted · device ${result.status} · seq ${result.receipt.sequence}`;
    } else {
      elements.v2EventStatus.value = `${label} · preview accepted · physical canary forwarding unavailable`;
    }
  } catch (error) { showError(error); }
});
elements.mqWeatherRefresh.addEventListener("click", async () => {
  try {
    const settings = mquickJsSettings();
    mquickJsSession.settings = settings;
    // The redesigned weather widget has no fixed place label, so any 5-digit
    // US ZIP is a valid physical delivery target, not only the original fixture.
    const physicalTarget = settings.countryCode === INPUT_LAB_MQUICKJS_PHYSICAL_WEATHER_TARGET.countryCode &&
      /^\d{5}$/u.test(settings.postalCode);
    const deviceTelemetry = browserDevice && mquickJsDeviceCapability && physicalTarget
      ? await browserDevice.probeMQuickJsTelemetry() : null;
    const currentRevision = deviceTelemetry?.weatherAppliedRevision ?? mquickJsSession.snapshot().revision;
    if (!Number.isInteger(currentRevision) || currentRevision < 0 || currentRevision >= 0x7fffffff) {
      throw new Error("Weather revision is exhausted or invalid; reconnect before another fixture update.");
    }
    const weatherRevision = currentRevision + 1;
    const snapshot = createInputLabDeterministicWeatherSnapshot(settings);
    const batch = createInputLabWeatherRpcBatch(snapshot, weatherRevision);
    for (const event of batch) mquickJsSession.dispatch(event);
    showMquickJsSnapshot(deviceTelemetry ? "Applying fixture weather to physical ID28…" :
      "Offline fixture weather revision");
    if (deviceTelemetry) {
      const { delivery, confirmation } = await browserDevice.runMQuickJsTransaction(
        async ({ sendHostEvents, probeTelemetry }) => {
          const delivered = await deliverInputLabMQuickJsWeatherBatch({ events: batch,
            generation: mquickJsDeviceCapability.generation, revision: weatherRevision,
            postalCode: settings.postalCode, countryCode: settings.countryCode, sendHostEvents });
          const confirmed = await confirmInputLabMQuickJsWeatherRender({ revision: weatherRevision,
            probeTelemetry });
          return Object.freeze({ delivery: delivered, confirmation: confirmed });
        });
      mquickJsRpcRevision = Math.max(mquickJsRpcRevision, weatherRevision);
      const place = snapshot.location.name.toUpperCase();
      elements.v2EventStatus.value = confirmation.status === "rendered"
        ? `Offline ${place} fixture revision ${weatherRevision} committed and rendered on physical ID28 · seq ${delivery.finalReceipt.sequence} · UI max ${confirmation.telemetry.uiMaximumUs} µs`
        : `Offline ${place} fixture revision ${weatherRevision} committed in the device runtime; it renders on the next ID28 entry · seq ${delivery.finalReceipt.sequence}`;
    } else if (browserDevice && mquickJsDeviceCapability && !physicalTarget) {
      elements.v2EventStatus.value = `Offline ${settings.postalCode} preview updated. Physical canary delivery requires a 5-digit US ZIP code.`;
    }
    scheduleAutosave();
  } catch (error) { showError(error); }
});
for (const [name, pressed] of [["keydown", true], ["keyup", false]]) elements.mqKeyPad.addEventListener(name, (event) => {
  const key = event.code === "KeyF" ? 0 : event.code === "KeyT" ? 1 : -1;
  if (key < 0 || event.repeat) return;
  event.preventDefault();
  mquickJsKeyLevel(key, pressed);
});
elements.export.addEventListener("click", exportProject);
elements.connectKeyboard.addEventListener("click", () => connectKeyboard().catch(showError));
elements.flashRenderer.addEventListener("click", () => flashRenderer().catch((error) => {
  elements.connectKeyboard.disabled = false;
  elements.usbStatus.textContent = "Flash stopped safely";
  showError(error);
}));
elements.apply.addEventListener("click", async () => {
  if (elements.apply.disabled || !bridge || !browserDevice) return;
  if (elements.rendererVersion.value === "v2" && elements.v2Backend.value === "mquickjs") {
    elements.status.value = "MicroQuickJS Package Push refused: the physical boot-lifetime canary advertises runtimeUploader=false.";
    return;
  }
  flushAutosave();
  setApplyBusy(true);
  const activeRenderV2 = elements.rendererVersion.value === "v2";
  showApplyProgress(activeRenderV2 ? "Compiling active V2 widget" : "Compiling slots");
  try {
    if (activeRenderV2) {
      const revision = renderV2Operations.revision;
      const device = browserDevice;
      const apiSource = createRenderV2ApiSource({ ...currentSource(), name: state.slots[state.activeSlot].name });
      await renderV2Operations.run("apply", async ({ assertCurrent }) => {
        const compiled = await request("/api/render-v2/compile", apiSource);
        assertCurrent();
        renderV2Events = Object.freeze([]);
        const normalized = showRenderV2Result(compiled);
        const onProgress = (event) => showApplyProgress(progressLabel(event),
          event.stage === "done" ? "done" : "busy");
        assertCurrent();
        const result = await device.pushRenderV2Package(decodeBase64(normalized.packageBase64), { onProgress });
        assertCurrent();
        renderV2DeviceCapability = device.renderV2Capabilities;
        updateRenderV2DeviceSupport();
        elements.status.value = `${result.status} · active widget → ID26 · ${result.bytes} bytes · generation ${result.generation}`;
        showApplyProgress("Done", "done");
      }, { revision });
      return;
    }
    if (!lastCompilation) await compile();
    const slots = currentProjectSlots();
    const onProgress = (event) => showApplyProgress(progressLabel(event), event.stage === "done" ? "done" : "busy");
    const compiled = await request("/api/bundle", { slots, activeSlot: state.activeSlot, generation: 1 });
    const result = await browserDevice.pushBundle(decodeBase64(compiled.bundleBase64), { onProgress });
    const delivery = result.proofBacked === true ? "proof-backed hardware push"
      : "UNPROVEN hardware canary · commit acknowledged; UI handoff unverified";
    elements.status.value = `${result.status} · ${result.slots} slots · ${result.bytes} bytes · ${delivery}`;
    showApplyProgress("Done", "done");
  } catch (error) {
    showApplyProgress("Error", "error");
    showError(error);
  } finally {
    setApplyBusy(false);
  }
});

for (const control of [elements.html, elements.css, elements.script, elements.mode]) control.addEventListener("input", markSourceEdited);
for (const control of [elements.fps, elements.duration, elements.maxBytes, elements.interaction,
  elements.v2KeyCode, elements.v2KeyRpcId, elements.mqZip, elements.mqUnits]) control.addEventListener("input", scheduleAutosave);
for (const control of [elements.mqZip, elements.mqUnits]) control.addEventListener("input", scheduleZipSyncConfigPush);
window.addEventListener("pagehide", flushAutosave);
globalThis.navigator?.hid?.addEventListener?.("disconnect", handleBrowserKeyboardDisconnect);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushAutosave();
});

const initial = state.slots[state.activeSlot];
loadSlot(initial ?? { mode: "auto", html: DEFAULT_INPUT_LAB_HTML, css: DEFAULT_INPUT_LAB_CSS });
renderSlots();
compile().catch(showError);
connectBridge();
requestAnimationFrame(animate);
