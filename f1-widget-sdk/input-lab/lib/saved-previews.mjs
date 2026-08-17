import { DEFAULT_INPUT_LAB_SLOTS, DEFAULT_RASTER_SETTINGS, DEFAULT_RENDER_V2_EVENT_CONFIG, DEFAULT_SLOT_NAMES,
  LEGACY_LESS_BETTER_CSS, LEGACY_LESS_BETTER_HTML } from "./scene-template.mjs";

export const INPUT_LAB_STORAGE_KEY = "framer-f1-input-lab-v1";

function cleanName(value, fallback) {
  const name = String(value ?? "").trim().slice(0, 32);
  return name || fallback;
}

export function makeInitialPreviewState() {
  return Object.freeze({ version: 4, activeSlot: 0, slots: DEFAULT_INPUT_LAB_SLOTS });
}

function normalizeMode(value, fallback = "auto") {
  return ["auto", "semantic", "raster"].includes(value) ? value : fallback;
}

function isExactLegacySecondSeed(slot) {
  const settings = { ...DEFAULT_RASTER_SETTINGS, ...(slot?.settings ?? {}) };
  return slot?.name === "Less better" && slot?.mode === "raster" &&
    slot?.html === LEGACY_LESS_BETTER_HTML && slot?.css === LEGACY_LESS_BETTER_CSS &&
    Object.entries(DEFAULT_RASTER_SETTINGS).every(([key, value]) => settings[key] === value);
}

function normalizeState(value) {
  const fallback = makeInitialPreviewState();
  if (!value || ![1, 2, 3, 4].includes(value.version) || !Array.isArray(value.slots) || value.slots.length !== 3) return fallback;
  const slots = value.slots.map((input, index) => {
    const slot = value.version < 3 && index === 1 && isExactLegacySecondSeed(input)
      ? DEFAULT_INPUT_LAB_SLOTS[index]
      : input;
    return Object.freeze({ id: index,
      name: cleanName(slot?.name, DEFAULT_SLOT_NAMES[index]),
      renderer: slot?.renderer === "v2" ? "v2" : "v1",
      script: typeof slot?.script === "string" ? slot.script : "",
      mode: value.version === 1 && slot?.mode === "semantic" ? "auto"
        : normalizeMode(slot?.mode, DEFAULT_INPUT_LAB_SLOTS[index].mode),
      html: typeof slot?.html === "string" ? slot.html : DEFAULT_INPUT_LAB_SLOTS[index].html,
      css: typeof slot?.css === "string" ? slot.css : DEFAULT_INPUT_LAB_SLOTS[index].css,
      settings: Object.freeze({ ...DEFAULT_RASTER_SETTINGS, ...(slot?.settings ?? {}) }),
      eventConfig: Object.freeze({
        keyboardCode: typeof slot?.eventConfig?.keyboardCode === "string"
          ? slot.eventConfig.keyboardCode : DEFAULT_RENDER_V2_EVENT_CONFIG.keyboardCode,
        keyboardRpcId: typeof slot?.eventConfig?.keyboardRpcId === "string"
          ? slot.eventConfig.keyboardRpcId : DEFAULT_RENDER_V2_EVENT_CONFIG.keyboardRpcId,
      }),
      compiled: slot?.compiled && typeof slot.compiled === "object" ? Object.freeze(slot.compiled) : null,
    });
  });
  const activeSlot = Number.isInteger(value.activeSlot) && value.activeSlot >= 0 && value.activeSlot < 3
    ? value.activeSlot : 0;
  return Object.freeze({ version: 4, activeSlot, slots });
}

export class SavedPreviewStore {
  constructor({ storage, key = INPUT_LAB_STORAGE_KEY } = {}) {
    if (!storage || typeof storage.getItem !== "function" || typeof storage.setItem !== "function") {
      throw new Error("SavedPreviewStore requires a localStorage-compatible adapter.");
    }
    this.storage = storage;
    this.key = key;
  }

  load() {
    try { return normalizeState(JSON.parse(this.storage.getItem(this.key) || "null")); } catch { return makeInitialPreviewState(); }
  }

  saveSlot(index, { name, html, css, renderer = "v1", script = "", mode = "auto",
    settings = DEFAULT_RASTER_SETTINGS, eventConfig = DEFAULT_RENDER_V2_EVENT_CONFIG, compiled = null }) {
    if (!Number.isInteger(index) || index < 0 || index >= 3) throw new Error("Preview slot must be 0, 1, or 2.");
    const current = this.load();
    const slots = current.slots.map((slot, slotIndex) => slotIndex === index ? Object.freeze({ id: index,
      name: cleanName(name, DEFAULT_SLOT_NAMES[index]), html: String(html), css: String(css),
      renderer: renderer === "v2" ? "v2" : "v1", script: String(script), mode: normalizeMode(mode),
      settings: Object.freeze({ ...DEFAULT_RASTER_SETTINGS, ...settings }),
      eventConfig: Object.freeze({ keyboardCode: String(eventConfig.keyboardCode ?? "Space"),
        keyboardRpcId: String(eventConfig.keyboardRpcId ?? "0xB201") }),
      compiled: compiled && typeof compiled === "object" ? Object.freeze(compiled) : null,
    }) : slot);
    const next = Object.freeze({ version: 4, activeSlot: index, slots });
    this.storage.setItem(this.key, JSON.stringify(next));
    return next;
  }

  renameSlot(index, name) {
    if (!Number.isInteger(index) || index < 0 || index >= 3) throw new Error("Preview slot must be 0, 1, or 2.");
    const current = this.load();
    const slots = current.slots.map((slot, slotIndex) => slotIndex === index
      ? Object.freeze({ ...slot, name: cleanName(name, DEFAULT_SLOT_NAMES[index]) })
      : slot);
    const next = Object.freeze({ ...current, version: 4, slots });
    this.storage.setItem(this.key, JSON.stringify(next));
    return next;
  }

  setActive(index) {
    const current = this.load();
    if (!Number.isInteger(index) || index < 0 || index >= 3) throw new Error("Preview slot must be 0, 1, or 2.");
    const next = Object.freeze({ ...current, version: 4, activeSlot: index });
    this.storage.setItem(this.key, JSON.stringify(next));
    return next;
  }
}
