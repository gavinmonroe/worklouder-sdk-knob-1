import { SavedPreviewStore } from "./lib/saved-previews.mjs";
import { DEFAULT_INPUT_LAB_CSS, DEFAULT_INPUT_LAB_HTML, DEFAULT_RASTER_SETTINGS } from "./lib/scene-template.mjs";
import { drawAtlasScene } from "./lib/browser-sampler.mjs";

const apiBase = location.protocol === "file:" ? "http://127.0.0.1:9231" : "";
const sessionToken = document.querySelector('meta[name="input-lab-session-token"]')?.content ?? "";
const elements = Object.freeze({ html: document.querySelector("#html-source"), css: document.querySelector("#css-source"),
  canvas: document.querySelector("#preview"), status: document.querySelector("#status"),
  active: document.querySelector("#active-slot"), slots: document.querySelector("#slot-list"),
  mode: document.querySelector("#mode"), fps: document.querySelector("#fps"), duration: document.querySelector("#duration"),
  maxBytes: document.querySelector("#max-bytes"), interaction: document.querySelector("#interaction"),
  stats: document.querySelector("#capture-stats"), filmstrip: document.querySelector("#filmstrip") });
const store = new SavedPreviewStore({ storage: localStorage });
let state = store.load();
let lastCompilation = null;
let animationStart = performance.now();
let rasterFrames = [];
let rasterFrameMs = 200;

function animate(now) {
  if (lastCompilation?.scene) drawAtlasScene(elements.canvas, lastCompilation.scene, lastCompilation.atlas,
    Math.floor((now - animationStart) / lastCompilation.scene.tickMs));
  else if (rasterFrames.length) {
    const image = rasterFrames[Math.floor((now - animationStart) / rasterFrameMs) % rasterFrames.length];
    if (image?.complete) elements.canvas.getContext("2d").drawImage(image, 0, 0, 100, 310);
  }
  requestAnimationFrame(animate);
}

async function request(path, body) {
  const headers = { "content-type": "application/json" };
  if (path === "/api/apply") {
    if (!/^[A-Za-z0-9_-]{43}$/u.test(sessionToken)) {
      throw new Error("Input Lab apply requires the session served by the localhost editor.");
    }
    headers["x-input-lab-session"] = sessionToken;
  }
  const response = await fetch(`${apiBase}${path}`, { method: "POST", headers,
    body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(`${result.error}: ${result.message}`);
  return result;
}

async function compile() {
  elements.status.value = "Compiling…";
  const source = currentSource();
  const result = elements.mode.value === "raster"
    ? await request("/api/capture", source)
    : await request("/api/compile", source);
  lastCompilation = result;
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
  elements.status.value = `${result.bytes ?? result.binaryBytes} bytes · ${result.sha256.slice(0, 12)}`;
  return result;
}

function settingsFromInputs() {
  return { fps: Number(elements.fps.value), loopDurationMs: Number(elements.duration.value),
    maxFrames: Math.min(60, Math.max(1, Math.round(Number(elements.duration.value) * Number(elements.fps.value) / 1000))),
    maxBytes: Number(elements.maxBytes.value), interaction: elements.interaction.value };
}

function currentSource() {
  return { mode: elements.mode.value, html: elements.html.value, css: elements.css.value,
    settings: settingsFromInputs() };
}

function compactCompilation(result) {
  if (!result) return null;
  if (result.mode === "raster") return { mode: "raster", sha256: result.sha256, bytes: result.bytes,
    animationBase64: result.animationBase64, stats: result.stats, settings: result.settings };
  return { mode: "semantic", sha256: result.sha256, binaryBytes: result.binaryBytes,
    binaryBase64: result.binaryBase64, atlas: result.atlas };
}

function loadSlot(slot) {
  elements.html.value = slot.html;
  elements.css.value = slot.css;
  elements.mode.value = slot.mode ?? "semantic";
  const settings = { ...DEFAULT_RASTER_SETTINGS, ...(slot.settings ?? {}) };
  elements.fps.value = settings.fps;
  elements.duration.value = settings.loopDurationMs;
  elements.maxBytes.value = settings.maxBytes;
  elements.interaction.value = settings.interaction;
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
    const actions = document.createElement("div");
    actions.className = "slot-actions";
    const load = document.createElement("button");
    load.textContent = "Load";
    load.addEventListener("click", async () => {
      state = store.setActive(index);
      loadSlot(slot);
      renderSlots();
      await compile().catch(showError);
    });
    const save = document.createElement("button");
    save.textContent = "Save";
    save.addEventListener("click", () => {
      state = store.saveSlot(index, { name: name.value, ...currentSource(), compiled: compactCompilation(lastCompilation) });
      renderSlots();
      elements.status.value = `Saved preview ${index + 1}`;
    });
    actions.append(load, save);
    row.append(name, actions);
    elements.slots.append(row);
  });
  const slot = state.slots[state.activeSlot];
  elements.active.textContent = `Active slot: ${state.activeSlot + 1} · ${slot.name}`;
}

function showError(error) { elements.status.value = error.message; }

document.querySelector("#compile").addEventListener("click", () => compile().catch(showError));
document.querySelector("#apply").addEventListener("click", async () => {
  try {
    if (!lastCompilation) await compile();
    const slots = state.slots.map((slot, index) => index === state.activeSlot
      ? { ...slot, ...currentSource() }
      : slot);
    const result = await request("/api/apply", { slots, activeSlot: state.activeSlot, generation: Date.now() >>> 0 });
    elements.status.value = `${result.status} · ${result.slots} slots · ${result.bytes} bytes · no hardware I/O`;
  } catch (error) { showError(error); }
});

const initial = state.slots[state.activeSlot];
loadSlot(initial ?? { mode: "semantic", html: DEFAULT_INPUT_LAB_HTML, css: DEFAULT_INPUT_LAB_CSS });
renderSlots();
compile().catch(showError);
requestAnimationFrame(animate);
