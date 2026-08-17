export const INPUT_LAB_PROJECT_FORMAT = "framer-f1-input-lab-project-v2";

const BLOCKED_TAG = /<(?:script|iframe|object|embed|base|meta|link|form|video|audio|source|track)\b/iu;
const EVENT_ATTRIBUTE = /\son[a-z]+\s*=/iu;
const HTML_NAVIGATION = /\s(?:href|src|srcset|action|formaction|poster|xlink:href)\s*=/iu;

function invariant(value, message) {
  if (!value) throw new Error(message);
}

function normalizeSource(slot, index) {
  invariant(slot && typeof slot === "object", `Preview ${index + 1} is missing.`);
  invariant(typeof slot.html === "string" && typeof slot.css === "string",
    `Preview ${index + 1} must contain HTML and CSS text.`);
  return Object.freeze({ id: index, name: String(slot.name ?? `Preview ${index + 1}`).trim().slice(0, 32),
    renderer: slot.renderer === "v2" ? "v2" : "v1",
    backend: slot.backend === "mquickjs" ? "mquickjs" : "f2ep",
    mode: ["auto", "semantic", "raster"].includes(slot.mode) ? slot.mode : "auto",
    html: slot.html, css: slot.css, script: typeof slot.script === "string" ? slot.script : "",
    settings: Object.freeze({ ...(slot.settings ?? {}) }),
    eventConfig: Object.freeze({ keyboardCode: String(slot.eventConfig?.keyboardCode ?? "Space"),
      keyboardRpcId: String(slot.eventConfig?.keyboardRpcId ?? "0xB201") }),
    mquickjs: Object.freeze({ example: slot.mquickjs?.example === "weather" ? "weather" : "timer",
      postalCode: String(slot.mquickjs?.postalCode ?? "60601"),
      countryCode: String(slot.mquickjs?.countryCode ?? "US"),
      units: slot.mquickjs?.units === "celsius" ? "celsius" : "fahrenheit" }) });
}

function cssUrlsAreLocal(source) {
  for (const match of source.matchAll(/url\s*\(\s*(["']?)(.*?)\1\s*\)/giu)) {
    const value = match[2].trim();
    if (!/^#[A-Za-z_][\w:.-]*$/u.test(value) && !/^data:image\/(?:png|gif|jpeg|webp);base64,[A-Za-z0-9+/=]+$/u.test(value)) return false;
  }
  return !/url\s*\(/iu.test(source.replaceAll(/url\s*\(\s*(["']?)(.*?)\1\s*\)/giu, ""));
}

export function createInputLabProject({ slots, activeSlot, exportedAt = new Date().toISOString() } = {}) {
  invariant(Array.isArray(slots) && slots.length === 3, "An Input Lab project requires exactly three previews.");
  invariant(Number.isInteger(activeSlot) && activeSlot >= 0 && activeSlot < 3,
    "An Input Lab project active slot must be 0, 1, or 2.");
  return Object.freeze({ format: INPUT_LAB_PROJECT_FORMAT, version: 2, viewport: Object.freeze({ width: 100, height: 310 }),
    exportedAt, activeSlot, slots: Object.freeze(slots.map(normalizeSource)) });
}

export function serializeInputLabProject(project) {
  invariant(project?.format === INPUT_LAB_PROJECT_FORMAT && project?.slots?.length === 3,
    "Input Lab can export only a valid three-preview project.");
  return `${JSON.stringify(project, null, 2)}\n`;
}

export function createOfflinePreviewDocument({ html, css, interaction = "none" } = {}) {
  invariant(typeof html === "string" && typeof css === "string", "Offline preview requires HTML and CSS text.");
  invariant(!BLOCKED_TAG.test(html), "Offline preview blocks executable, navigable, and embedded document elements.");
  invariant(!EVENT_ATTRIBUTE.test(html), "Offline preview blocks event-handler attributes.");
  invariant(!HTML_NAVIGATION.test(html), "Offline preview blocks navigable or external resource attributes.");
  invariant(!/<\/style/iu.test(css), "Offline preview CSS cannot close its containing style element.");
  invariant(!/@import\b|expression\s*\(|javascript\s*:/iu.test(css), "Offline preview blocks executable CSS.");
  invariant(cssUrlsAreLocal(css), "Offline preview CSS URLs must be local SVG fragments or cached data images.");
  const bodyClass = interaction === "hover" ? "input-lab-hover" : "";
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" ` +
    `content="default-src 'none'; base-uri 'none'; connect-src 'none'; form-action 'none'; frame-src 'none'; ` +
    `img-src data:; media-src 'none'; object-src 'none'; script-src 'none'; style-src 'unsafe-inline'; worker-src 'none'">` +
    `<style>html,body{width:100px;height:310px;margin:0;overflow:hidden;background:#000}${css}</style></head>` +
    `<body class="${bodyClass}">${html}</body></html>`;
}
