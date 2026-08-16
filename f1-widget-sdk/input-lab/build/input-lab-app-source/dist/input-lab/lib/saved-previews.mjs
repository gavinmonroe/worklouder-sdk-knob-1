import { DEFAULT_INPUT_LAB_SLOTS, DEFAULT_RASTER_SETTINGS, DEFAULT_SLOT_NAMES } from "./scene-template.mjs";

export const INPUT_LAB_STORAGE_KEY = "framer-f1-input-lab-v1";

function cleanName(value, fallback) {
  const name = String(value ?? "").trim().slice(0, 32);
  return name || fallback;
}

export function makeInitialPreviewState() {
  return Object.freeze({ version: 1, activeSlot: 0, slots: DEFAULT_INPUT_LAB_SLOTS });
}

function normalizeState(value) {
  const fallback = makeInitialPreviewState();
  if (!value || value.version !== 1 || !Array.isArray(value.slots) || value.slots.length !== 3) return fallback;
  const slots = value.slots.map((slot, index) => Object.freeze({ id: index,
    name: cleanName(slot?.name, DEFAULT_SLOT_NAMES[index]),
    mode: slot?.mode === "raster" ? "raster" : DEFAULT_INPUT_LAB_SLOTS[index].mode,
    html: typeof slot?.html === "string" ? slot.html : DEFAULT_INPUT_LAB_SLOTS[index].html,
    css: typeof slot?.css === "string" ? slot.css : DEFAULT_INPUT_LAB_SLOTS[index].css,
    settings: Object.freeze({ ...DEFAULT_RASTER_SETTINGS, ...(slot?.settings ?? {}) }),
    compiled: slot?.compiled && typeof slot.compiled === "object" ? Object.freeze(slot.compiled) : null,
  }));
  const activeSlot = Number.isInteger(value.activeSlot) && value.activeSlot >= 0 && value.activeSlot < 3
    ? value.activeSlot : 0;
  return Object.freeze({ version: 1, activeSlot, slots });
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

  saveSlot(index, { name, html, css, mode = "semantic", settings = DEFAULT_RASTER_SETTINGS, compiled = null }) {
    if (!Number.isInteger(index) || index < 0 || index >= 3) throw new Error("Preview slot must be 0, 1, or 2.");
    const current = this.load();
    const slots = current.slots.map((slot, slotIndex) => slotIndex === index ? Object.freeze({ id: index,
      name: cleanName(name, DEFAULT_SLOT_NAMES[index]), html: String(html), css: String(css),
      mode: mode === "raster" ? "raster" : "semantic", settings: Object.freeze({ ...DEFAULT_RASTER_SETTINGS, ...settings }),
      compiled: compiled && typeof compiled === "object" ? Object.freeze(compiled) : null,
    }) : slot);
    const next = Object.freeze({ version: 1, activeSlot: index, slots });
    this.storage.setItem(this.key, JSON.stringify(next));
    return next;
  }

  setActive(index) {
    const current = this.load();
    if (!Number.isInteger(index) || index < 0 || index >= 3) throw new Error("Preview slot must be 0, 1, or 2.");
    const next = Object.freeze({ ...current, activeSlot: index });
    this.storage.setItem(this.key, JSON.stringify(next));
    return next;
  }
}
