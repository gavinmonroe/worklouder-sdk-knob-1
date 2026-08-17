import { SavedPreviewStore } from "./lib/saved-previews.mjs";
import { DEFAULT_INPUT_LAB_CSS, DEFAULT_INPUT_LAB_HTML, DEFAULT_RASTER_SETTINGS,
  DEFAULT_RENDER_V2_CSS, DEFAULT_RENDER_V2_HTML, DEFAULT_RENDER_V2_SCRIPT } from "./lib/scene-template.mjs";
import { drawAtlasScene } from "./lib/browser-sampler.mjs";
import { InputLabBridgeClient } from "./lib/bridge-client.mjs";
import { createInputLabProject, createOfflinePreviewDocument, serializeInputLabProject } from "./lib/browser-project.mjs";
import { browserHidAvailable, BrowserFramerSceneClient } from "./lib/browser-scene-hid.mjs";
import { BrowserKeyRpcBridge, normalizeKeyboardRpcConfig } from "./lib/browser-key-rpc.mjs";
import { appendRenderV2PreviewEvent, createRenderV2ApiSource, createRenderV2PreviewEvent,
  drawRenderV2Frame, normalizeRenderV2Result, parseRenderV2HostRpcId } from "./lib/render-v2-browser.mjs";

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
  v2KeyStatus: document.querySelector("#v2-key-status") });
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
let keyboardBridge = null;

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
  const mixedV1Project = !activeRenderV2 && projectContainsRenderV2();
  const renderV2Blocked = activeRenderV2 && !renderV2DeviceCapability;
  elements.apply.disabled = value || !bridge || !browserDevice || mixedV1Project || renderV2Blocked;
  elements.apply.setAttribute("aria-busy", String(value));
  elements.apply.textContent = value ? "Applying…"
    : activeRenderV2 && renderV2DeviceCapability ? "Apply V2 to ID26"
      : renderV2Blocked || mixedV1Project ? "Push unavailable" : "Apply / Push";
  elements.apply.title = !bridge ? "Wait for the Input Lab compiler service"
    : !browserDevice ? "Connect the keyboard over WebHID to enable Push"
      : mixedV1Project ? "Render v1 Push requires all three saved previews to remain Render v1"
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
  replaceKeyValues(elements.v2Budget, [
    ["states", budget.states], ["handlers", budget.handlers], ["bindings", budget.bindings],
    ["variants", budget.variants], ["spans", budget.spans], ["patch bytes", budget.pixelBytes],
    ["program", `${compiled.programBytes} B`], ["package", `${compiled.packageBytes} B`],
  ]);
  const applied = Number.isInteger(compiled.eventsApplied) ? ` · ${compiled.eventsApplied} events` : "";
  const changed = Number.isInteger(compiled.changedPixels) ? ` · ${compiled.changedPixels} px changed` : "";
  elements.v2EventStatus.value = `${eventLabel}${applied}${changed} · sequence ${renderV2Events.length}/64`;
  const pushReason = renderV2DeviceCapability ? "connected generic renderer can apply this package to ID26"
    : compiled.push?.reason ?? "custom Render v2 device Push is unavailable on this firmware";
  elements.status.value = `Render v2 · ${compiled.packageBytes} bytes · ${compiled.sha256.slice(0, 12)} · ${pushReason}`;
  return compiled;
}

async function compileRenderV2(source) {
  renderV2Events = Object.freeze([]);
  elements.v2EventStatus.value = "Compiling bounded event program…";
  const result = await request("/api/render-v2/compile", createRenderV2ApiSource({
    ...source, name: state.slots[state.activeSlot].name,
  }));
  return showRenderV2Result(result);
}

async function compile() {
  elements.status.value = "Compiling…";
  const source = currentSource();
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
  return { renderer: elements.rendererVersion.value, mode: elements.mode.value,
    html: elements.html.value, css: elements.css.value, script: elements.script.value,
    settings: settingsFromInputs(), eventConfig: { keyboardCode: elements.v2KeyCode.value,
      keyboardRpcId: elements.v2KeyRpcId.value } };
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
    programSha256: result.programSha256, budget: result.budget, push: result.push };
  if (result.mode === "raster") return { mode: "raster", sha256: result.sha256, bytes: result.bytes,
    animationBase64: result.animationBase64, stats: result.stats, settings: result.settings };
  return { mode: "semantic", sha256: result.sha256, binaryBytes: result.binaryBytes,
    binaryBase64: result.binaryBase64, atlas: result.atlas };
}

function syncRendererUi() {
  const renderV2 = elements.rendererVersion.value === "v2";
  for (const setting of document.querySelectorAll(".v1-setting")) setting.hidden = renderV2;
  elements.scriptHeading.hidden = !renderV2;
  elements.script.hidden = !renderV2;
  elements.rendererNotice.hidden = !renderV2;
  elements.v2Controls.hidden = !renderV2;
  if (renderV2 && renderV2Events.length === 0 && lastCompilation?.mode !== "render-v2") {
    elements.v2EventStatus.value = "Compile to begin deterministic event simulation.";
    elements.v2State.replaceChildren();
    elements.v2Budget.replaceChildren();
  }
  setApplyBusy(applyBusy);
}

function updateRenderV2DeviceSupport() {
  const ready = Boolean(renderV2DeviceCapability && browserDevice);
  elements.v2DeviceSupport.dataset.state = ready ? "ready" : "blocked";
  elements.v2DeviceSupport.textContent = ready ? "Device ID26 ready" : "Preview only";
  const forwarding = ready ? "device forwarding ready" : "device forwarding unavailable";
  if (!keyboardBridge?.pressed) {
    elements.v2KeyStatus.value = `Browser key → host RPC · down 1 / up 0 · ${forwarding}`;
  }
  setApplyBusy(applyBusy);
}

function loadSlot(slot) {
  elements.html.value = slot.html;
  elements.css.value = slot.css;
  elements.script.value = slot.script ?? "";
  elements.rendererVersion.value = slot.renderer === "v2" ? "v2" : "v1";
  elements.mode.value = slot.mode ?? "auto";
  const settings = { ...DEFAULT_RASTER_SETTINGS, ...(slot.settings ?? {}) };
  elements.fps.value = settings.fps;
  elements.duration.value = settings.loopDurationMs;
  elements.maxBytes.value = settings.maxBytes;
  elements.interaction.value = settings.interaction;
  elements.v2KeyCode.value = slot.eventConfig?.keyboardCode ?? "Space";
  elements.v2KeyRpcId.value = slot.eventConfig?.keyboardRpcId ?? "0xB201";
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

function showError(error) { elements.status.value = error.message; }

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
  elements.connectKeyboard.disabled = true;
  elements.flashRenderer.disabled = !("serial" in navigator);
  const v2Status = renderV2DeviceCapability ? "generic V2 ID26 ready" : "V2 preview only";
  elements.usbStatus.textContent = `Connected · firmware 0.4.1 · ${v2Status} · serial ${client.device.serialNumber}`;
  updateRenderV2DeviceSupport();
}

async function flashRenderer() {
  if (!browserDevice) throw new Error("Connect the keyboard before flashing.");
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
  updateRenderV2DeviceSupport();
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
  for (const control of [elements.v2Reset, elements.v2Tick100, elements.v2Tick1s,
    elements.v2KnobDown, elements.v2KnobUp, elements.v2HostSend]) control.disabled = value;
  elements.v2Controls.setAttribute("aria-busy", String(value));
}

async function dispatchRenderV2Event(event, label) {
  if (renderV2Busy) return;
  if (elements.rendererVersion.value !== "v2") throw new Error("Select Render v2 before simulating events.");
  if (!bridge) throw new Error("Render v2 event simulation requires the Input Lab compiler service.");
  const previous = renderV2Events;
  const next = appendRenderV2PreviewEvent(previous, event);
  setRenderV2Busy(true);
  elements.v2EventStatus.value = `Applying ${label}…`;
  try {
    const source = createRenderV2ApiSource({ ...currentSource(), name: state.slots[state.activeSlot].name }, next);
    const result = await request("/api/render-v2/simulate", source);
    renderV2Events = next;
    showRenderV2Result(result, label);
  } catch (error) {
    renderV2Events = previous;
    elements.v2EventStatus.value = error.message;
    throw error;
  } finally {
    setRenderV2Busy(false);
  }
}

function nextRenderV2Event(options) {
  return createRenderV2PreviewEvent({ ...options, sequence: renderV2Events.length + 1 });
}

function loadRenderV2Example() {
  if (!window.confirm("Replace this preview's HTML, CSS, and widget JS with the bounded Render v2 event example?")) return;
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

function markSourceEdited() {
  scheduleAutosave();
  if (elements.rendererVersion.value !== "v2") return;
  renderV2Events = Object.freeze([]);
  lastCompilation = null;
  elements.v2EventStatus.value = "Source changed · compile before simulating events.";
  elements.v2State.replaceChildren();
  elements.v2Budget.replaceChildren();
  setApplyBusy(applyBusy);
}

async function dispatchKeyboardRpcLevel({ id, value, code, phase, reason, synthetic }) {
  const label = `${code} ${phase}${synthetic ? ` (${reason})` : ""}`;
  await dispatchRenderV2Event(nextRenderV2Event({ kind: "host.rpc", id, value }), label);
  if (browserDevice && renderV2DeviceCapability) {
    await browserDevice.sendRenderV2HostEvent(id, value);
    elements.v2KeyStatus.value = `${label} · preview updated · forwarded to device ID26`;
  } else {
    elements.v2KeyStatus.value = `${label} · preview updated · device forwarding unavailable`;
  }
}

keyboardBridge = new BrowserKeyRpcBridge({
  element: elements.v2KeyPad,
  getConfig: () => {
    if (renderV2Events.length > 62) throw new Error("Reset the simulation before another keyboard down/up pair.");
    return normalizeKeyboardRpcConfig({ code: elements.v2KeyCode.value, rpcId: elements.v2KeyRpcId.value });
  },
  onEvent: async (payload) => {
    try { await dispatchKeyboardRpcLevel(payload); }
    catch (error) { elements.v2KeyStatus.value = error.message; throw error; }
  },
  onStatus: (payload) => {
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
  elements.connectKeyboard.disabled = false;
  elements.flashRenderer.disabled = true;
  elements.usbStatus.textContent = "Keyboard disconnected · reconnect to enable device Push";
  updateRenderV2DeviceSupport();
}

document.querySelector("#compile").addEventListener("click", () => compile().catch(showError));
elements.rendererVersion.addEventListener("change", () => {
  renderV2Events = Object.freeze([]);
  lastCompilation = null;
  syncRendererUi();
  scheduleAutosave();
});
elements.loadV2Example.addEventListener("click", loadRenderV2Example);
elements.v2Reset.addEventListener("click", () => compile().catch(showError));
elements.v2Tick100.addEventListener("click", () => dispatchRenderV2Event(
  nextRenderV2Event({ kind: "tick.100ms", value: 1 }), "tick.100ms").catch(showError));
elements.v2Tick1s.addEventListener("click", () => dispatchRenderV2Event(
  nextRenderV2Event({ kind: "tick.1s", value: 1 }), "tick.1s").catch(showError));
elements.v2KnobDown.addEventListener("click", () => dispatchRenderV2Event(
  nextRenderV2Event({ kind: "input.fn-bottom-knob", value: -1 }), "Fn + bottom dial −1").catch(showError));
elements.v2KnobUp.addEventListener("click", () => dispatchRenderV2Event(
  nextRenderV2Event({ kind: "input.fn-bottom-knob", value: 1 }), "Fn + bottom dial +1").catch(showError));
elements.v2HostSend.addEventListener("click", () => {
  try {
    const id = parseRenderV2HostRpcId(elements.v2HostId.value);
    const value = Number(elements.v2HostValue.value);
    dispatchRenderV2Event(nextRenderV2Event({ kind: "host.rpc", id, value }),
      `host.rpc:0x${id.toString(16).toUpperCase()}`).catch(showError);
  } catch (error) { showError(error); elements.v2EventStatus.value = error.message; }
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
  flushAutosave();
  setApplyBusy(true);
  const activeRenderV2 = elements.rendererVersion.value === "v2";
  showApplyProgress(activeRenderV2 ? "Compiling active V2 widget" : "Compiling slots");
  try {
    if (activeRenderV2) {
      const compiled = await compileRenderV2(currentSource());
      const onProgress = (event) => showApplyProgress(progressLabel(event),
        event.stage === "done" ? "done" : "busy");
      const result = await browserDevice.pushRenderV2Package(decodeBase64(compiled.packageBase64), { onProgress });
      renderV2DeviceCapability = browserDevice.renderV2Capabilities;
      updateRenderV2DeviceSupport();
      elements.status.value = `${result.status} · active widget → ID26 · ${result.bytes} bytes · generation ${result.generation}`;
      showApplyProgress("Done", "done");
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

for (const control of [elements.html, elements.css, elements.script]) control.addEventListener("input", markSourceEdited);
for (const control of [elements.mode, elements.fps, elements.duration,
  elements.maxBytes, elements.interaction, elements.v2KeyCode,
  elements.v2KeyRpcId]) control.addEventListener("input", scheduleAutosave);
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
