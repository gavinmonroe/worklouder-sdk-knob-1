const glyphs = "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲンガギグゲゴザジズゼゾダヂヅデドバビブベボパピプペポ";

export const DEFAULT_INPUT_LAB_HTML = `<div class="input-scene">${
  Array.from({ length: 75 }, (_, index) => `<span>${glyphs[index % glyphs.length]}</span>`).join("")
}</div>`;

export const DEFAULT_INPUT_LAB_CSS = `.input-scene {
  background-color: #121212;
  color: #d6d3d1;
}

.input-scene > span {
  color: #d6d3d1;
  animation: breathe 4s ease-in-out 0s infinite;
}

.input-scene > span:nth-child(3n) {
  color: #d97757;
  animation: breathe 3s ease-in-out 0.4s infinite;
}

@keyframes breathe {
  0% { color: rgba(214, 211, 209, 0.35); text-shadow: none; }
  50% { color: #fff7ed; text-shadow: 0 0 10px rgba(255, 247, 237, 0.55); }
  100% { color: rgba(214, 211, 209, 0.35); text-shadow: none; }
}`;

export const DEFAULT_SLOT_NAMES = Object.freeze(["Working", "Less better", "Electric"]);

export const REFERENCE_INPUT_LAB_CSS = `.input-scene {
  background-color: #070615;
  color: #f0abfc;
}

.input-scene > span {
  color: #60a5fa;
  animation: pulse 2s ease-in-out 0s infinite;
}

.input-scene > span:nth-child(2n) {
  color: #f472b6;
  animation: pulse 1.6s ease-in-out 0.3s infinite;
}

@keyframes pulse {
  0% { color: rgba(96, 165, 250, 0.25); text-shadow: none; }
  50% { color: #fdf4ff; text-shadow: 0 0 8px rgba(244, 114, 182, 0.65); }
  100% { color: rgba(96, 165, 250, 0.25); text-shadow: none; }
}`;

export const RADIAL_NOISE_HTML = `<div class="poster">
  <svg class="grain" viewBox="0 0 100 310" aria-hidden="true">
    <filter id="noise"><feTurbulence type="fractalNoise" baseFrequency="0.72" numOctaves="3" seed="7"/></filter>
    <rect width="100" height="310" filter="url(#noise)" opacity="0.18"/>
  </svg>
  <div class="orb"></div>
  <p>LESS<br>BUT<br>BETTER</p>
</div>`;

export const RADIAL_NOISE_CSS = `html, body { background: #151310; }
.poster { position: relative; width: 100px; height: 310px; overflow: hidden; background: #151310; color: #ede7dc; }
.orb { position: absolute; width: 128px; height: 128px; left: -14px; top: 70px; border-radius: 50%;
  background: radial-gradient(circle at 42% 38%, #d97757 0 12%, #8f3f2b 38%, #151310 72%);
  animation: breathe 2s ease-in-out infinite; }
.grain { position: absolute; inset: 0; width: 100%; height: 100%; mix-blend-mode: soft-light; }
p { position: absolute; left: 10px; bottom: 18px; margin: 0; font: 700 18px/0.92 ui-monospace, monospace; letter-spacing: -1px; }
@keyframes breathe { 50% { transform: scale(1.08); filter: saturate(1.18); } }`;

export const DEFAULT_RASTER_SETTINGS = Object.freeze({ fps: 5, loopDurationMs: 2000, maxFrames: 10,
  maxBytes: 131072, interaction: "none" });

export const DEFAULT_INPUT_LAB_SLOTS = Object.freeze([
  Object.freeze({ id: 0, name: "Working", mode: "semantic", html: DEFAULT_INPUT_LAB_HTML,
    css: DEFAULT_INPUT_LAB_CSS, settings: DEFAULT_RASTER_SETTINGS, compiled: null }),
  Object.freeze({ id: 1, name: "Less better", mode: "raster", html: RADIAL_NOISE_HTML,
    css: RADIAL_NOISE_CSS, settings: DEFAULT_RASTER_SETTINGS, compiled: null }),
  Object.freeze({ id: 2, name: "Electric", mode: "semantic", html: DEFAULT_INPUT_LAB_HTML,
    css: REFERENCE_INPUT_LAB_CSS, settings: DEFAULT_RASTER_SETTINGS, compiled: null }),
]);
